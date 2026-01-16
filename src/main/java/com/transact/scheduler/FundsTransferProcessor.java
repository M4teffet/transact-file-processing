package com.transact.scheduler;

import com.api.client.ProcessingFt;
import com.api.client.ProcessingResponse;
import com.api.client.TransactionRequest;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.transact.processor.model.*;
import io.quarkus.logging.Log;
import io.quarkus.panache.common.Parameters;
import io.quarkus.scheduler.Scheduled;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.context.control.ActivateRequestContext;
import jakarta.inject.Inject;
import jakarta.ws.rs.WebApplicationException;
import jakarta.ws.rs.core.Response;
import org.bson.types.ObjectId;
import org.eclipse.microprofile.context.ManagedExecutor;
import org.eclipse.microprofile.rest.client.inject.RestClient;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Semaphore;

import static io.quarkus.scheduler.Scheduled.ConcurrentExecution.SKIP;

/**
 * Core processor for handling Funds Transfer (FT) batches.
 */
@ApplicationScoped
public class FundsTransferProcessor {

    private static final String FEATURE_KEY = "FUNDS_TRANSFER";
    private static final int MAX_RETRY = 3;
    private static final int MAX_THREADS = 2;

    @Inject
    @RestClient
    ProcessingFt processingFt;

    @Inject
    ObjectMapper objectMapper;

    @Inject
    ManagedExecutor managedExecutor;

    @Scheduled(every = "1m", identity = "ft-processor", concurrentExecution = SKIP)
    @ActivateRequestContext
    public void run() {

        Application app = Application.findByName(FEATURE_KEY);

        if (app == null) {
            Log.errorf("[FT] Application config missing");
            ProcessingLogEntry.log("ERROR", "[FT] Application config missing");
            return;
        }

        if (!AppFeatureConfig.isFeatureEnabled(FEATURE_KEY)) {
            String msg = FEATURE_KEY + " Processing disabled by Administrator";
            Log.errorf("%s", msg);
            ProcessingLogEntry.log("ERROR", msg);
            return;
        }

        List<FileBatch> batches = FileBatch.list(
                "status in :statuses and applicationId = :appId",
                Parameters.with("statuses", List.of(FileBatch.STATUS_VALIDATED, FileBatch.STATUS_PROCESSING))
                        .and("appId", app.id)
        );

        if (batches.isEmpty()) return;

        Log.infof("[FT] %d batch(es) detected for processing", batches.size());

        for (FileBatch batch : batches) {
            try {
                processBatch(batch.id);
            } catch (Exception e) {
                String msg = String.format("CRITICAL_BATCH_FAILURE: %s", e.getMessage());
                Log.errorf("[%s] %s", batch.id, msg);
                ProcessingLogEntry.log(batch.id, "ERROR", msg);
            }
        }
    }

    private void processBatch(ObjectId batchId) {
        String workerId = UUID.randomUUID().toString();
        FileBatch batch = FileBatch.findById(batchId);

        String validatedById = batch.validatedById;

        AppUser user = AppUser.findById(validatedById);

        String country = user.countryCode;

        String companyId = Country.findByCode(country);

        // Recovery logic
        recoverRows(batchId);

        // Mark batch as processing
        FileBatch.update("status = ?1, processingTimestamp = ?2", FileBatch.STATUS_PROCESSING, Instant.now())
                .where("_id", batchId);

        List<BatchData> rows = BatchData.findByBatchId(batchId);

        // --- MULTI-THREADING LOGIC START ---

        // 1. Semaphore to enforce strictly 2 threads active at once
        Semaphore concurrencyLimiter = new Semaphore(MAX_THREADS);

        // 2. List to keep track of all tasks so we can wait for them at the end
        List<CompletableFuture<Void>> futures = new ArrayList<>();

        for (BatchData row : rows) {
            try {
                // Acquire a permit. If 2 threads are running, this blocks the main thread
                // until one finishes, ensuring we don't flood the executor queue.
                concurrencyLimiter.acquire();

                CompletableFuture<Void> future = CompletableFuture.runAsync(() -> {
                    try {
                        processRow(row, workerId, batchId, companyId);
                    } catch (Exception e) {
                        Log.errorf("Unexpected thread error row %d: %s", row.lineNumber, e.getMessage());
                    } finally {
                        // Release permit so the next row can be picked up
                        concurrencyLimiter.release();
                    }
                }, managedExecutor);

                futures.add(future);

            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                Log.errorf("Batch %s processing interrupted", batchId);
                break;
            }
        }

        // 3. Wait for ALL rows to finish before finalizing the batch
        if (!futures.isEmpty()) {
            CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).join();
        }

        // --- MULTI-THREADING LOGIC END ---
        finalizeBatch(batchId);
    }

    private void recoverRows(ObjectId batchId) {
        long reset = BatchData.update("processingStatus = 'PENDING', workerId = null, retryCount = retryCount + 1")
                .where("batchId = :batchId and processingStatus = 'CLAIMED'",
                        Parameters.with("batchId", batchId));

        if (reset > 0) {
            String msg = String.format("Recovery: %d row(s) reset", reset);
            Log.warnf("[%s] %s", batchId, msg);
            ProcessingLogEntry.log(batchId, "WARN", msg);
        }

        long poisoned = BatchData.update("processingStatus = 'FAILED_PERMANENT'")
                .where("batchId = :batchId and processingStatus = 'PENDING' and retryCount >= :max",
                        Parameters.with("batchId", batchId).and("max", MAX_RETRY));

        if (poisoned > 0) {
            String msg = String.format("Poison pill: %d row(s) exceeded retry limit", poisoned);
            Log.errorf("[%s] %s", batchId, msg);
            ProcessingLogEntry.log(batchId, "ERROR", msg);
        }
    }

    private void processRow(BatchData row, String workerId, ObjectId batchId, String companyId) {

        if (!BatchData.claimRow(row.id, workerId)) {
            Log.debugf("[%s|Row:%d] SKIPPED: Already claimed", batchId, row.lineNumber);
            return;
        }

        String ctx = String.format("[%s|Row:%d]", batchId, row.lineNumber);
        String correlationId = batchId + "-" + row.lineNumber;

        TransactionRequest req = mapToRequest(row.data);
        String payloadJson = serializePayload(req);

        ProcessingLogEntry.log(batchId, "INFO",
                String.format("Row %d: Starting processing. Payload: %s", row.lineNumber, payloadJson));

        Response response = null;

        try {
            try {
                response = processingFt.processTransaction(req, correlationId, companyId);
            } catch (WebApplicationException e) {
                response = e.getResponse();
            }

            // If response is still null (e.g. connection refused), throw to outer catch
            if (response == null) {
                Log.errorf("%s PROCESS_ERR: %s", ctx, "No response received from T24 Service");
                ProcessingLogEntry.log(batchId, "ERROR",
                        String.format("Row %d: CRITICAL EXCEPTION. Error: %s | Sent Payload: %s", row.lineNumber, "No response received from T24 Service", payloadJson));
            }

            // 3. Process the Response (Success or Error)
            // We use a try-finally here to ensure the response is closed only after we read it
            try {
                // Read body ONCE
                String body = response.readEntity(String.class);

                // Handle Empty Body edge case
                if (body == null || body.isBlank()) {
                    String msg = "HTTP " + response.getStatus() + " with Empty Body";
                    handleFailure(batchId, row, msg, payloadJson);
                    return;
                }

                // Parse JSON
                ProcessingResponse res = objectMapper.readValue(body, ProcessingResponse.class);

                // --- A. SUCCESS PATH ---
                if (response.getStatus() < 400 && res.isSuccessful()) {
                    String ref = (res.header != null) ? res.header.id : "N/A";
                    Log.infof("%s SUCCESS: T24 Ref %s", ctx, ref);
                    ProcessingLogEntry.log(batchId, "INFO", String.format("Row %d: SUCCESS. T24 Ref: %s", row.lineNumber, ref));
                    completeRow(batchId, row, ref);
                    return;
                }

                // --- B. ERROR / IDEMPOTENCY PATH ---
                String errorMsg = res.getErrorMessage();
                String transId = (res.header != null) ? res.header.id : null;

                // Check for "Already Exists" in the error message
                if (errorMsg != null && errorMsg.contains("already Exists")) {
                    String finalRef = (transId != null) ? transId : "EXISTING";

                    Log.warnf("%s IDEMPOTENCY HIT: %s. Switching to SUCCESS.", ctx, errorMsg);
                    ProcessingLogEntry.log(batchId, "WARN",
                            String.format("Row %d: Already Exists. Treating as Success. Ref: %s", row.lineNumber, finalRef));

                    completeRow(batchId, row, finalRef);
                } else {
                    // Real Failure
                    String finalError = (errorMsg != null) ? errorMsg : "HTTP " + response.getStatus();
                    Log.errorf("%s REJECTED: %s", ctx, finalError);
                    handleFailure(batchId, row, finalError, payloadJson);
                }
            } finally {
                response.close();
            }

        } catch (Exception ex) {
            // 4. Handle System/Network Crashes (Connection Refused, Serialization Error, etc.)
            String err = extractErrorMessage(ex);
            Log.errorf("%s PROCESS_ERR: %s", ctx, err);
            ProcessingLogEntry.log(batchId, "ERROR",
                    String.format("Row %d: CRITICAL EXCEPTION. Error: %s | Sent Payload: %s", row.lineNumber, err, payloadJson));
            failRow(batchId, row, err);
        }
    }

    public void completeRow(ObjectId batchId, BatchData row, String ref) {
        try {
            new RowResult(batchId, row.lineNumber, "SUCCESS", ref, null).persist();
        } catch (Exception ignored) {
        }
        BatchData.update("processingStatus = 'COMPLETED'").where("_id", row.id);
    }

    private void failRow(ObjectId batchId, BatchData row, String err) {
        try {
            new RowResult(batchId, row.lineNumber, "FAILED", null, err).persist();
        } catch (Exception ignored) {
        }
        BatchData.update("processingStatus = 'FAILED'").where("_id", row.id);
    }

    private void finalizeBatch(ObjectId batchId) {
        BatchStatistics stats = BatchStatistics.calculate(batchId);
        if (stats == null) return;

        long pendingCount = BatchData.count("batchId = ?1 and processingStatus in ?2",
                batchId, List.of("PENDING", "CLAIMED"));

        if (pendingCount > 0) {
            Log.infof("[%s] Processing still in progress (%d rows remaining)", batchId, pendingCount);
            return;
        }

        String status;
        if (stats.failureCount == 0 && stats.successCount > 0) {
            status = FileBatch.STATUS_PROCESSED;
        } else if (stats.successCount > 0 && stats.failureCount > 0) {
            status = FileBatch.STATUS_PROCESSED_PARTIAL;
        } else {
            status = FileBatch.STATUS_PROCESSED_FAILED;
        }

        FileBatch.update("status = ?1, processingTimestamp = ?2", status, Instant.now())
                .where("_id", batchId);

        stats.batchStatus = status;
        stats.lastUpdatedAt = Instant.now();
        stats.persistOrUpdate();

        String summary = String.format("Status=%s | Success=%d | Fail=%d", status, stats.successCount, stats.failureCount);
        Log.infof("[%s] FINALIZED: %s", batchId, summary);
        ProcessingLogEntry.log(batchId, "INFO", "Batch Finalized. " + summary);
    }

    private void handleFailure(ObjectId batchId, BatchData row, String msg, String payload) {
        ProcessingLogEntry.log(batchId, "ERROR",
                String.format("Row %d Failed. Reason: %s | Sent Payload: %s", row.lineNumber, msg, payload));
        failRow(batchId, row, msg);
    }

    private String extractErrorMessage(Throwable t) {
        if (t instanceof WebApplicationException w && w.getResponse() != null) {
            try {
                // Ensure we only read the body once
                String body = w.getResponse().readEntity(String.class);
                if (body == null || body.isBlank()) return "Empty error response";

                ProcessingResponse res = objectMapper.readValue(body, ProcessingResponse.class);

                // If the object mapped correctly, use its internal logic
                String businessError = res.getErrorMessage();
                if (businessError != null) return businessError;

                // Fallback: If mapping didn't find specific error fields but it's valid JSON
                return body;
            } catch (Exception ex) {
                // Log that parsing failed but return the raw body so you can at least see the error
                Log.error("Failed to parse error response body", ex);
            }
        }
        return Optional.ofNullable(t.getMessage()).orElse(t.getClass().getSimpleName());
    }

    private TransactionRequest mapToRequest(Map<String, Object> data) {
        TransactionRequest r = new TransactionRequest();
        r.body = new TransactionRequest.RequestBody();
        if (data != null) {
            data.forEach((k, v) -> {
                if (v != null) populateField(r, k, v.toString());
            });
        }
        return r;
    }

    private String serializePayload(TransactionRequest req) {
        try {
            return objectMapper.writeValueAsString(req);
        } catch (Exception e) {
            return "[Serialization Error: " + e.getMessage() + "]";
        }
    }

    private void populateField(TransactionRequest r, String k, String v) {
        String val = v.trim();
        if (val.isEmpty()) return;
        switch (k) {
            case "TRANSACTION.TYPE" -> r.body.transactionType = val;
            case "DEBIT.ACCT.NO" -> r.body.debitAcctNo = val;
            case "DEBIT.CURRENCY" -> r.body.debitCurrency = val;
            case "DEBIT.AMOUNT" -> r.body.debitAmount = parseAmount(val);
            case "DEBIT.VALUE.DATE" -> r.body.debitValueDate = val;
            case "DEBIT.THEIR.REF" -> r.body.debitTheirRef = val;
            case "CREDIT.ACCT.NO" -> r.body.creditAcctNo = val;
            case "CREDIT.CURRENCY" -> r.body.creditCurrency = val;
            case "CREDIT.AMOUNT" -> r.body.creditAmount = parseAmount(val);
            case "CREDIT.VALUE.DATE" -> r.body.creditValueDate = val;
            case "CREDIT.THEIR.REF" -> r.body.creditTheirRef = val;
            case "PROCESSING.DATE" -> r.body.processingDate = val;
            case "EXPOSURE.DATE" -> r.body.exposureDate = val;
            case "PAYMENT.DETAILS" -> r.body.paymentDetails = val;
            case "ORDERING.CUST" -> r.body.orderingCust = val;
            case "ORDERING.BANK" -> r.body.orderingBank = val;
            case "COMMISSION.CODE" -> r.body.commissionCode = val;
            case "COMMISSION.TYPE" -> r.body.commissionType = val;
            case "COMMISSION.AMT" -> r.body.commissionAmt = parseAmount(val);
            case "CHARGE.CODE" -> r.body.chargeCode = val;
            case "CHARGE.TYPE" -> r.body.chargeType = val;
            case "CHARGE.AMT" -> r.body.chargeAmt = parseAmount(val);
            case "PROFIT.CENTRE.CUST" -> r.body.profitCentreCust = val;
            case "PROFIT.CENTRE.DEPT" -> r.body.profitCentreDept = val;
        }
    }

    private BigDecimal parseAmount(String val) {
        try {
            return new BigDecimal(val.replace(",", ""));
        } catch (Exception e) {
            return null;
        }
    }

}