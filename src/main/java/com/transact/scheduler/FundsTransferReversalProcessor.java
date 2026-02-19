package com.transact.scheduler;

import com.api.client.ProcessingFt;
import com.api.client.ProcessingResponse;
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

import java.time.Instant;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicInteger;

import static io.quarkus.scheduler.Scheduled.ConcurrentExecution.SKIP;

@ApplicationScoped
public class FundsTransferReversalProcessor {

    private static final String FEATURE_KEY = "FUNDS_TRANSFER_REVERSAL";
    private final AtomicInteger activeProcessors = new AtomicInteger(0);
    @ConfigProperty(name = "ft.reversal.processor.max-retry", defaultValue = "3")
    int maxRetry;
    @ConfigProperty(name = "ft.reversal.processor.max-threads", defaultValue = "2")
    int maxThreads;
    @Inject
    @RestClient
    ProcessingFt processingFt;
    @Inject
    ObjectMapper objectMapper;
    @Inject
    ManagedExecutor managedExecutor;

    @Scheduled(every = "1m", identity = "ft-reversal-processor", concurrentExecution = SKIP)
    @ActivateRequestContext
    public void run() {
        Application app = Application.findByName(FEATURE_KEY);

        if (app == null) {
            Log.errorf("[FT_REV] Application config missing for key: %s", FEATURE_KEY);
            ProcessingLogEntry.log("ERROR", String.format("[FT_REV] Application config missing: %s", FEATURE_KEY));
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

        Log.infof("[FT_REV] %d batch(es) detected for processing", batches.size());

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

            // Retrieve user country to determine company ID
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

            // Atomic update to mark batch as PROCESSING
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
        // Reset stuck rows (CLAIMED -> PENDING)
        long reset = BatchData.update(
                        "processingStatus = 'PENDING', workerId = null, retryCount = retryCount + 1"
                )
                .where("batchId = :batchId and processingStatus = 'CLAIMED'",
                        Parameters.with("batchId", batchId));

        if (reset > 0) {
            Log.warnf("[%s] Recovery: %d row(s) reset", batchId, reset);
        }

        // Poison pill for rows exceeding max retries
        long poisoned = BatchData.update("processingStatus = 'FAILED_PERMANENT'")
                .where("batchId = :batchId and processingStatus = 'PENDING' and retryCount >= :max",
                        Parameters.with("batchId", batchId).and("max", maxRetry));

        if (poisoned > 0) {
            Log.errorf("[%s] Poison pill: %d row(s) exceeded retry limit", batchId, poisoned);
        }
    }

    private void processRow(BatchData row, String workerId, ObjectId batchId, String companyId) {
        // Attempt to claim the row atomically
        if (!BatchData.claimRow(row.id, workerId)) {
            return;
        }

        String ctx = String.format("[%s|Row:%d]", batchId, row.lineNumber);

        String t24Reference = getT24Reference(row.data);
        if (t24Reference == null || t24Reference.trim().isEmpty()) {
            failRow(batchId, row, "Missing or empty T24.REFERENCE");
            return;
        }

        String payloadJson = "{\"t24Reference\":\"" + t24Reference + "\"}";

        Response response;

        try {
            // 1. Execute Remote Call
            try {
                response = processingFt.reverseTransaction(t24Reference, companyId);
            } catch (WebApplicationException e) {
                response = e.getResponse();
            }

            if (response == null) {
                failRow(batchId, row, "No response from T24");
                return;
            }

            // 2. Process Response (Try-with-resources ensures closure)
            try (Response resp = response) {
                String body = resp.readEntity(String.class);

                if (body == null || body.isBlank()) {
                    handleFailure(batchId, row, "Empty response body", payloadJson);
                    return;
                }

                // Deserialize into ProcessingResponse (ignores linkedActivities automatically)
                ProcessingResponse res = objectMapper.readValue(body, ProcessingResponse.class);

                // 2a. Success Scenario
                if (resp.getStatus() < 400 && res.isSuccessful()) {
                    // Extract ID from header safely
                    String ref = (res.header != null) ? res.header.id : "N/A";
                    Log.infof("%s SUCCESS: %s", ctx, ref);
                    completeRow(batchId, row, ref);
                    return;
                }

                // 2b. Error Scenario
                String errorMsg = res.getErrorMessage();

                // Fallback for failed extraction (e.g., generic HTTP error)
                if (errorMsg == null) {
                    errorMsg = "HTTP " + resp.getStatus();
                    // Attempt to grab full error from JSON if detail was missing
                    if (res.error != null && res.error.type != null) {
                        errorMsg += " [" + res.error.type + "]";
                    }
                }

                // Idempotency / Already Reversed handling
                if (errorMsg.contains("already reversed") || errorMsg.contains("duplicate")) {
                    String ref = (res.header != null) ? res.header.id : "EXISTING";
                    Log.warnf("%s IDEMPOTENCY: %s", ctx, errorMsg);
                    completeRow(batchId, row, ref);
                } else {
                    handleFailure(batchId, row, errorMsg, payloadJson);
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
            // Save result log (idempotent check)
            long existing = RowResult.count("batchId = ?1 and lineNumber = ?2", batchId, row.lineNumber);
            if (existing == 0) {
                new RowResult(batchId, row.lineNumber, "SUCCESS", ref, null).persist();
            }
        } catch (Exception ignored) {
        }

        // Mark row as COMPLETED
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

        // Mark row as FAILED
        BatchData.update("processingStatus = 'FAILED'")
                .where("_id = ?1 and processingStatus != 'FAILED'", row.id);
    }

    private void finalizeBatch(ObjectId batchId) {
        BatchStatistics stats = BatchStatistics.calculate(batchId);
        if (stats == null) return;

        // Ensure all rows are done
        long pendingCount = BatchData.count("batchId = ?1 and processingStatus in ?2",
                batchId, List.of("PENDING", "CLAIMED"));

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

        // Final atomic update
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

    private void handleFailure(ObjectId batchId, BatchData row, String msg, String payload) {
        ProcessingLogEntry.log(batchId, "ERROR",
                String.format("Row %d Failed: %s | Payload: %s", row.lineNumber, msg, payload));
        failRow(batchId, row, msg);
    }

    private String extractErrorMessage(Throwable t) {
        if (t == null) return "Unknown error";

        // Attempt to extract JSON message from WebApplicationException response
        if (t instanceof WebApplicationException w && w.getResponse() != null) {
            try (Response resp = w.getResponse()) {
                // Buffer entity allows multiple reads if necessary
                // resp.bufferEntity();
                String body = resp.readEntity(String.class);
                if (body != null && !body.isBlank()) {
                    ProcessingResponse res = objectMapper.readValue(body, ProcessingResponse.class);
                    String err = res.getErrorMessage();
                    if (err != null) return err;
                }
            } catch (Exception ignored) {
                // Fallback if parsing fails
            }
        }

        return Optional.ofNullable(t.getMessage()).orElse(t.getClass().getSimpleName());
    }

    private String getT24Reference(Map<String, Object> data) {
        if (data == null) return null;
        Object value = data.get("T24.REFERENCE");
        return (value != null) ? value.toString().trim() : null;
    }
}