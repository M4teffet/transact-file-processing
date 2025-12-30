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
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static io.quarkus.scheduler.Scheduled.ConcurrentExecution.SKIP;

/**
 * Core processor for handling Funds Transfer (FT) batches.
 */
@ApplicationScoped
public class FundsTransferProcessor {

    private static final String FEATURE_KEY = "FUNDS_TRANSFER";
    private static final int MAX_RETRY = 3;
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
                Log.errorf("[%s] CRITICAL_BATCH_FAILURE: %s", batch.id, e.getMessage());
            }

        }
    }

    private void processBatch(ObjectId batchId) {
        String workerId = UUID.randomUUID().toString();
        FileBatch batch = FileBatch.findById(batchId);
        if (batch == null) return;

        // Recovery logic
        recoverRows(batchId);

        // Mark batch as processing
        FileBatch.update("status = ?1, processingTimestamp = ?2", FileBatch.STATUS_PROCESSING, Instant.now())
                .where("_id", batchId);

        List<BatchData> rows = BatchData.findByBatchId(batchId);
        for (BatchData row : rows) {
            processRow(row, workerId, batchId);
        }

        finalizeBatch(batchId);
    }

    private void recoverRows(ObjectId batchId) {
        // Resetting claimed rows that timed out/crashed
        long reset = BatchData.update("processingStatus = 'PENDING', workerId = null, retryCount = retryCount + 1")
                .where("batchId = :batchId and processingStatus = 'CLAIMED'",
                        Parameters.with("batchId", batchId));

        if (reset > 0) {
            Log.warnf("[%s] Recovery: %d row(s) reset", batchId, reset);
        }

        // Moving poisoned rows to permanent failure
        long poisoned = BatchData.update("processingStatus = 'FAILED_PERMANENT'")
                .where("batchId = :batchId and processingStatus = 'PENDING' and retryCount >= :max",
                        Parameters.with("batchId", batchId).and("max", MAX_RETRY));

        if (poisoned > 0) {
            Log.errorf("[%s] Poison pill: %d row(s) exceeded retry limit", batchId, poisoned);
        }
    }

    private void processRow(BatchData row, String workerId, ObjectId batchId) {

        if (!BatchData.claimRow(row.id, workerId)) {
            Log.debugf("[%s|Row:%d] SKIPPED: Already claimed or ID mismatch", batchId, row.lineNumber);
            return;
        }

        String ctx = String.format("[%s|Row:%d]", batchId, row.lineNumber);
        String correlationId = batchId + "-" + row.lineNumber;

        TransactionRequest req = mapToRequest(row.data);
        Response response = null;

        try {
            response = processingFt.processTransaction(req, correlationId);
            int status = response.getStatus();
            String body = response.readEntity(String.class);

            if (status >= 400) {
                Log.errorf("%s T24_HTTP_ERR: %d | %s", ctx, status, body);
                failRow(batchId, row, "HTTP " + status + ": " + body);
                return;
            }

            ProcessingResponse res = objectMapper.readValue(body, ProcessingResponse.class);
            if (res.isSuccessful()) {
                String ref = (res.header != null) ? res.header.id : null;
                Log.infof("%s SUCCESS: T24 Ref %s", ctx, ref);
                completeRow(batchId, row, ref);
            } else {
                String err = res.getErrorMessage();
                Log.warnf("%s BUSINESS_REJECT: %s", ctx, err);
                failRow(batchId, row, err);
            }

        } catch (Exception ex) {
            String err = extractErrorMessage(ex);
            Log.errorf("%s PROCESS_ERR: %s", ctx, err);
            failRow(batchId, row, err);
        } finally {
            if (response != null) response.close();
        }
    }

    private void completeRow(ObjectId batchId, BatchData row, String ref) {
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

        // Ensure we don't finalize if processing is still happening
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
        // ... update FileBatch and stats ...
        FileBatch.update("status = ?1, processingTimestamp = ?2", status, Instant.now())
                .where("_id", batchId);

        stats.batchStatus = status;
        stats.lastUpdatedAt = Instant.now();
        stats.persistOrUpdate();

        Log.infof("[%s] FINALIZED: Status=%s | Success=%d | Fail=%d",
                batchId, status, stats.successCount, stats.failureCount);
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
