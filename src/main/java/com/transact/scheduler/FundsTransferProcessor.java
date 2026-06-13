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
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.context.ManagedExecutor;
import org.eclipse.microprofile.rest.client.inject.RestClient;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicInteger;

import static io.quarkus.scheduler.Scheduled.ConcurrentExecution.SKIP;

/**
 * FundsTransferProcessor - IMPROVED VERSION
 *
 * Improvements:
 * - ✅ Fixed resource leaks (Response properly closed with try-with-resources)
 * - ✅ Fixed race conditions (atomic WHERE clauses in updates)
 * - ✅ Configurable settings via application.properties
 * - ✅ Better null safety and error handling
 * - ✅ Active processor tracking
 */
@ApplicationScoped
public class FundsTransferProcessor {

    private static final String FEATURE_KEY = "FUNDS_TRANSFER";

    private final AtomicInteger activeProcessors = new AtomicInteger(0);
    @ConfigProperty(name = "ft.processor.max-retry", defaultValue = "3")
    int maxRetry;

    @Inject
    @RestClient
    ProcessingFt processingFt;

    @Inject
    ObjectMapper objectMapper;

    @Inject
    ManagedExecutor managedExecutor;
    @ConfigProperty(name = "ft.processor.max-threads", defaultValue = "2")
    int maxThreads;

    @Scheduled(every = "1m", identity = "ft-processor", concurrentExecution = SKIP)
    @ActivateRequestContext
    public void run() {
        Application app = Application.findByName(FEATURE_KEY);

        if (app == null) {
            Log.errorf("[FT] Application config missing for key: %s", FEATURE_KEY);
            ProcessingLogEntry.log("ERROR", String.format("[FT] Application config missing: %s", FEATURE_KEY));
            return;
        }

        if (!AppFeatureConfig.isFeatureEnabled(FEATURE_KEY)) {
            Log.debugf("%s processing disabled", FEATURE_KEY);
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
                Log.errorf(e, "[%s] %s", batch.id, msg);
                ProcessingLogEntry.log(batch.id, "ERROR", msg);
            }
        }
    }


    private void processBatch(ObjectId batchId) {
        activeProcessors.incrementAndGet();
        String workerId = UUID.randomUUID().toString();

        try {
            FileBatch batch = FileBatch.findById(batchId);
            if (batch == null) {
                Log.errorf("[%s] Batch not found!", batchId);
                return;
            }

            String country = AppUser.findByUsername(batch.validatedById)
                    .map(AppUser::getCountryCode)
                    .orElse(null);

            if (country == null) {
                Log.errorf("[%s] Validator country not found: %s", batchId, batch.validatedById);
                return;
            }

            String companyId = Country.findByCode(country);
            if (companyId == null) {
                Log.errorf("[%s] Company ID not found for country: %s", batchId, country);
                return;
            }

            recoverRows(batchId);

            // ✅ FIXED: Atomic update with WHERE clause
            long updated = FileBatch.update(
                            "status = ?1, processingTimestamp = ?2",
                            FileBatch.STATUS_PROCESSING,
                            Instant.now()
                    )
                    .where("_id = ?1 and status in ?2",
                            batchId,
                            List.of(FileBatch.STATUS_VALIDATED, FileBatch.STATUS_PROCESSING));

            if (updated == 0) {
                Log.warnf("[%s] Already being processed", batchId);
                return;
            }

            List<BatchData> rows = BatchData.findByBatchId(batchId);
            if (rows.isEmpty()) {
                finalizeBatch(batchId);
                return;
            }

            Semaphore concurrencyLimiter = new Semaphore(maxThreads);
            List<CompletableFuture<Void>> futures = new ArrayList<>();

            for (BatchData row : rows) {
                try {
                    concurrencyLimiter.acquire();

                    CompletableFuture<Void> future = CompletableFuture.runAsync(() -> {
                        try {
                            processRow(row, workerId, batchId, companyId);
                        } catch (Exception e) {
                            Log.errorf(e, "[%s|Row:%d] Error: %s", batchId, row.lineNumber, e.getMessage());
                        } finally {
                            concurrencyLimiter.release();
                        }
                    }, managedExecutor);

                    futures.add(future);

                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    Log.errorf("[%s] Processing interrupted", batchId);
                    break;
                }
            }

            if (!futures.isEmpty()) {
                CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).join();
            }

            finalizeBatch(batchId);

        } finally {
            activeProcessors.decrementAndGet();
        }
    }

    private void recoverRows(ObjectId batchId) {
        long reset = BatchData.update(
                        "processingStatus = 'PENDING', workerId = null, retryCount = retryCount + 1"
                )
                .where("batchId = :batchId and processingStatus = 'CLAIMED'",
                        Parameters.with("batchId", batchId));

        if (reset > 0) {
            Log.warnf("[%s] Recovery: %d row(s) reset", batchId, reset);
        }

        long poisoned = BatchData.update("processingStatus = 'FAILED_PERMANENT'")
                .where("batchId = :batchId and processingStatus = 'PENDING' and retryCount >= :max",
                        Parameters.with("batchId", batchId).and("max", maxRetry));

        if (poisoned > 0) {
            Log.errorf("[%s] Poison pill: %d row(s) exceeded retry limit", batchId, poisoned);
        }
    }

    @ConfigProperty(name = "app.processing.stuck-timeout-minutes", defaultValue = "30")
    int stuckTimeoutMinutes;

    private void processRow(BatchData row, String workerId, ObjectId batchId, String companyId) {
        if (!BatchData.claimRow(row.id, workerId)) {
            return;
        }

        String ctx = String.format("[%s|Row:%d]", batchId, row.lineNumber);
        String correlationId = batchId + "-" + row.lineNumber;

        TransactionRequest req = mapToRequest(row.data);
        String payloadJson = serializePayload(req);

        Response response = null;

        try {
            try {
                response = processingFt.processTransaction(req, correlationId, companyId);
            } catch (WebApplicationException e) {
                response = e.getResponse();
            }

            if (response == null) {
                noResponseRow(batchId, row, "No response from T24 (null)");
                return;
            }

            // ✅ FIXED: Use try-with-resources to close Response
            try (Response resp = response) {
                String body = resp.readEntity(String.class);

                if (body == null || body.isBlank()) {
                    noResponseRow(batchId, row, "Empty response body from T24");
                    return;
                }

                ProcessingResponse res = objectMapper.readValue(body, ProcessingResponse.class);

                if (resp.getStatus() < 400 && res.isSuccessful()) {
                    String ref = (res.header != null) ? res.header.id : "N/A";
                    Log.infof("%s SUCCESS: %s", ctx, ref);
                    completeRow(batchId, row, ref);
                    return;
                }

                String errorMsg = res.getErrorMessage();

                if (errorMsg != null && errorMsg.contains("already Exists")) {
                    String ref = (res.header != null) ? res.header.id : "EXISTING";
                    Log.warnf("%s IDEMPOTENCY: %s", ctx, errorMsg);
                    completeRow(batchId, row, ref);
                } else {
                    String finalError = (errorMsg != null) ? errorMsg : "HTTP " + resp.getStatus();
                    handleFailure(batchId, row, finalError, payloadJson);
                }
            }

        } catch (Exception ex) {
            String err = extractErrorMessage(ex);
            Log.errorf(ex, "%s EXCEPTION: %s", ctx, err);
            failRow(batchId, row, err);
        }
    }

    public void completeRow(ObjectId batchId, BatchData row, String ref) {
        try {
            long existing = RowResult.count("batchId = ?1 and lineNumber = ?2", batchId, row.lineNumber);
            if (existing == 0) {
                new RowResult(batchId, row.lineNumber, "SUCCESS", ref, null).persist();
            }
        } catch (Exception ignored) {
        }

        // ✅ FIXED: Atomic with WHERE clause
        BatchData.update("processingStatus = 'COMPLETED'")
                .where("_id = ?1 and processingStatus != 'COMPLETED'", row.id);
    }

    private void failRow(ObjectId batchId, BatchData row, String err) {
        try {
            long existing = RowResult.count("batchId = ?1 and lineNumber = ?2", batchId, row.lineNumber);
            if (existing == 0) {
                new RowResult(batchId, row.lineNumber, "FAILED", null, err).persist();
            }
        } catch (Exception ignored) {
        }

        // ✅ FIXED: Atomic with WHERE clause
        BatchData.update("processingStatus = 'FAILED'")
                .where("_id = ?1 and processingStatus != 'FAILED'", row.id);
    }

    private void noResponseRow(ObjectId batchId, BatchData row, String err) {
        try {
            long existing = RowResult.count("batchId = ?1 and lineNumber = ?2", batchId, row.lineNumber);
            if (existing == 0) {
                new RowResult(batchId, row.lineNumber, "NO_RESPONSE", null, err).persist();
            }
        } catch (Exception ignored) {
        }

        BatchData.update("processingStatus = 'NO_RESPONSE'")
                .where("_id = ?1 and processingStatus not in ?2",
                        row.id, List.of("COMPLETED", "NO_RESPONSE"));
    }

    private void handleFailure(ObjectId batchId, BatchData row, String msg, String payload) {
        ProcessingLogEntry.log(batchId, "ERROR",
                String.format("Row %d Failed: %s | Payload: %s", row.lineNumber, msg, payload));
        failRow(batchId, row, msg);
    }

    private String extractErrorMessage(Throwable t) {
        if (t == null) return "Unknown error";

        if (t instanceof WebApplicationException w && w.getResponse() != null) {
            try (Response resp = w.getResponse()) {
                String body = resp.readEntity(String.class);
                if (body != null && !body.isBlank()) {
                    ProcessingResponse res = objectMapper.readValue(body, ProcessingResponse.class);
                    String err = res.getErrorMessage();
                    if (err != null) return err;
                }
            } catch (Exception ignored) {
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
            return "[Serialization Error]";
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

    private void finalizeBatch(ObjectId batchId) {
        BatchStatistics stats = BatchStatistics.calculate(batchId);
        if (stats == null) return;

        long pendingCount = BatchData.count("batchId = ?1 and processingStatus in ?2",
                batchId, List.of("PENDING", "CLAIMED", "NO_RESPONSE"));

        if (pendingCount > 0) {
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

        // ✅ FIXED: Atomic with WHERE clause
        long updated = FileBatch.update(
                        "status = ?1, processingTimestamp = ?2",
                        status,
                        Instant.now()
                )
                .where("_id = ?1 and status = ?2",
                        batchId,
                        FileBatch.STATUS_PROCESSING);

        if (updated == 0) {
            return;
        }

        stats.batchStatus = status;
        stats.lastUpdatedAt = Instant.now();
        stats.persistOrUpdate();

        Log.infof("[%s] FINALIZED: %s | S:%d F:%d", batchId, status, stats.successCount, stats.failureCount);
    }

    /**
     * Watchdog: any batch stuck in PROCESSING for longer than the configured
     * timeout with no active BatchData rows (PENDING/CLAIMED) is force-reset
     * to VALIDATED so the next scheduler tick can pick it up again.
     * Runs every 5 minutes, skips if already executing.
     */
    @Scheduled(every = "5m", identity = "stuck-batch-watchdog", concurrentExecution = SKIP)
    @ActivateRequestContext
    public void resetStuckBatches() {
        Instant cutoff = Instant.now().minusSeconds((long) stuckTimeoutMinutes * 60);

        List<FileBatch> stuckBatches = FileBatch.list(
                "status = ?1 and processingTimestamp < ?2",
                FileBatch.STATUS_PROCESSING, cutoff);

        for (FileBatch batch : stuckBatches) {
            long activePending = BatchData.count(
                    "batchId = ?1 and processingStatus in ?2",
                    batch.id, List.of("PENDING", "CLAIMED"));

            if (activePending > 0) continue; // still genuinely running

            Log.warnf("[Watchdog] Batch %s stuck in PROCESSING since %s — resetting to VALIDATED",
                    batch.id.toHexString(), batch.processingTimestamp);

            long reset = FileBatch.update("status = ?1", FileBatch.STATUS_VALIDATED)
                    .where("_id = ?1 and status = ?2", batch.id, FileBatch.STATUS_PROCESSING);

            if (reset > 0) {
                // Reset any CLAIMED rows so they can be re-processed
                BatchData.update("processingStatus = 'PENDING', workerId = null")
                        .where("batchId = ?1 and processingStatus = 'CLAIMED'", batch.id);

                ProcessingLogEntry.log(batch.id, "WARN",
                        String.format("Watchdog: lot bloqué en PROCESSING depuis %d min — réinitialisé en VALIDATED",
                                stuckTimeoutMinutes));
            }
        }
    }
    @Scheduled(cron = "0 0 3 * * ?", identity = "otp-token-purge", concurrentExecution = SKIP)
    @ActivateRequestContext
    public void purgeExpiredOtpTokens() {
        try {
            long removed = com.transact.processor.model.OtpToken.purgeExpired();
            if (removed > 0) {
                Log.infof("[OTP] Purged %d expired token(s)", removed);
            }
        } catch (Exception e) {
            Log.warnf(e, "[OTP] Purge failed: %s", e.getMessage());
        }
    }
}