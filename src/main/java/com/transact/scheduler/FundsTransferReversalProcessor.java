package com.transact.scheduler;

import com.api.client.ProcessingFt;
import com.api.client.ProcessingResponse;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mongodb.client.model.Filters;
import com.mongodb.client.model.Updates;
import com.transact.processor.model.*;
import com.transact.service.EmailService;
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

    @ConfigProperty(name = "ft.reversal.processor.max-threads", defaultValue = "2")
    int maxThreads;

    @ConfigProperty(name = "app.base-url", defaultValue = "http://localhost:8080")
    String baseUrl;

    @Inject
    EmailService emailService;
    @Inject
    @RestClient
    ProcessingFt processingFt;
    @Inject
    ObjectMapper objectMapper;
    @Inject
    ManagedExecutor managedExecutor;

    // ── Scheduler ─────────────────────────────────────────────────────────────

    @Scheduled(every = "1m", identity = "ft-reversal-processor", concurrentExecution = SKIP)
    @ActivateRequestContext
    public void run() {
        Application app = Application.findByName(FEATURE_KEY);
        if (app == null) {
            Log.errorf("[FT_REV] Application config missing for key: %s", FEATURE_KEY);
            ProcessingLogEntry.log("ERROR", "[FT_REV] Application config missing: " + FEATURE_KEY);
            return;
        }

        if (!AppFeatureConfig.isFeatureEnabled(FEATURE_KEY)) {
            Log.debugf("%s processing disabled", FEATURE_KEY);
            return;
        }

        // VALIDATED = new batch ready to run
        // PROCESSING = batch was mid-flight when the system failed — pick it up and resume
        List<FileBatch> batches = FileBatch.list(
                "status in :statuses and applicationId = :appId",
                Parameters.with("statuses", List.of(FileBatch.STATUS_VALIDATED, FileBatch.STATUS_PROCESSING))
                        .and("appId", app.id)
        );

        if (batches.isEmpty()) return;

        Log.infof("[FT_REV] %d batch(es) to process", batches.size());

        for (FileBatch batch : batches) {
            try {
                processBatch(batch.id);
            } catch (Exception e) {
                String msg = "CRITICAL_BATCH_FAILURE: " + e.getMessage();
                Log.errorf(e, "[%s] %s", batch.id, msg);
                ProcessingLogEntry.log(batch.id, "ERROR", msg);
            }
        }
    }

    // ── Batch processing ──────────────────────────────────────────────────────

    private void processBatch(ObjectId batchId) {
        activeProcessors.incrementAndGet();
        String workerId = UUID.randomUUID().toString();

        try {
            FileBatch batch = FileBatch.findById(batchId);
            if (batch == null) {
                Log.errorf("[%s] Batch not found", batchId);
                return;
            }

            String country = AppUser.findByUsername(batch.validatedById)
                    .map(AppUser::getCountryCode).orElse(null);
            if (country == null) {
                Log.errorf("[%s] Validator country not found: %s", batchId, batch.validatedById);
                return;
            }

            String companyId = Country.findByCode(country);
            if (companyId == null) {
                Log.errorf("[%s] Company ID not found for country: %s", batchId, country);
                return;
            }

            // Reset any rows left in CLAIMED state from a previous crashed run.
            // A crash is not a failure — retryCount is NOT incremented.
            recoverRows(batchId);

            // Atomic transition — native MongoDB driver, no Panache DSL parameter ambiguity
            long updated = FileBatch.mongoCollection().updateOne(
                    Filters.and(
                            Filters.eq("_id", batchId),
                            Filters.in("status", FileBatch.STATUS_VALIDATED, FileBatch.STATUS_PROCESSING)
                    ),
                    Updates.combine(
                            Updates.set("status", FileBatch.STATUS_PROCESSING),
                            Updates.set("processingTimestamp", Instant.now())
                    )
            ).getModifiedCount();

            if (updated == 0) {
                Log.warnf("[%s] Batch status changed externally — skipping", batchId);
                return;
            }

            // Only PENDING rows need work. COMPLETED and FAILED rows are already done.
            List<BatchData> rows = BatchData.findPendingByBatchId(batchId);

            if (rows.isEmpty()) {
                // All rows already resolved (restart after finalize failed to write status).
                finalizeBatch(batchId);
                return;
            }

            Semaphore limiter = new Semaphore(maxThreads);
            List<CompletableFuture<Void>> futures = new ArrayList<>();

            for (BatchData row : rows) {
                try {
                    limiter.acquire();
                    futures.add(CompletableFuture.runAsync(() -> {
                        try {
                            processRow(row, workerId, batchId, companyId);
                        } catch (Exception e) {
                            Log.errorf(e, "[%s|Row:%d] REV unexpected error in processRow — forcing FAILED",
                                    batchId, row.lineNumber);
                            try {
                                BatchData.update("processingStatus = 'FAILED'")
                                        .where("_id = ?1 and processingStatus = 'CLAIMED'", row.id);
                            } catch (Exception ex2) {
                                Log.errorf(ex2, "[%s|Row:%d] REV safety-net update also failed",
                                        batchId, row.lineNumber);
                            }
                        } finally {
                            limiter.release();
                        }
                    }, managedExecutor));
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    Log.errorf("[%s] Interrupted while queuing rows", batchId);
                    break;
                }
            }

            if (!futures.isEmpty()) {
                try {
                    CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).join();
                } catch (Exception e) {
                    Log.warnf("[%s] REV one or more futures completed exceptionally: %s",
                            batchId, e.getMessage());
                }
            }

            long orphaned = BatchData.update("processingStatus = 'FAILED'")
                    .where("batchId = ?1 and processingStatus = 'CLAIMED'", batchId);
            if (orphaned > 0)
                Log.warnf("[%s] REV force-failed %d orphaned CLAIMED row(s)", batchId, orphaned);

            finalizeBatch(batchId);

        } finally {
            activeProcessors.decrementAndGet();
        }
    }

    // ── Row recovery ──────────────────────────────────────────────────────────

    private void recoverRows(ObjectId batchId) {
        long claimed = BatchData.update("processingStatus = 'PENDING', workerId = null")
                .where("batchId = :batchId and processingStatus = 'CLAIMED'",
                        Parameters.with("batchId", batchId));
        if (claimed > 0) {
            Log.warnf("[%s] REV recovered %d CLAIMED row(s) → PENDING (system restart)", batchId, claimed);
            ProcessingLogEntry.log(batchId, "WARN",
                    String.format("Récupération REV après redémarrage : %d ligne(s) relancée(s)", claimed));
        }
    }

    // ── Row-level processing ──────────────────────────────────────────────────

    private void processRow(BatchData row, String workerId, ObjectId batchId, String companyId) {
        if (!BatchData.claimRow(row.id, workerId)) return;

        String ctx = String.format("[%s|Row:%d]", batchId, row.lineNumber);

        String t24Reference = getT24Reference(row.data);
        if (t24Reference == null || t24Reference.isBlank()) {
            failRow(batchId, row, "Missing or empty T24.REFERENCE");
            return;
        }

        String payloadJson = "{\"t24Reference\":\"" + t24Reference + "\"}";
        Response response;

        try {
            try {
                response = processingFt.reverseTransaction(t24Reference, companyId);
            } catch (WebApplicationException e) {
                response = e.getResponse();
            }

            // No response at all — treat as failure
            if (response == null) {
                failRow(batchId, row, "No response from T24");
                return;
            }

            try (Response resp = response) {
                String body = resp.readEntity(String.class);

                // Empty body — treat as failure
                if (body == null || body.isBlank()) {
                    failRow(batchId, row, "Empty response body from T24");
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
                if (errorMsg == null) {
                    errorMsg = "HTTP " + resp.getStatus();
                    if (res.error != null && res.error.type != null)
                        errorMsg += " [" + res.error.type + "]";
                }

                // Idempotency: already reversed → count as success
                if (errorMsg.contains("already reversed") || errorMsg.contains("duplicate")) {
                    Log.warnf("%s IDEMPOTENCY: %s", ctx, errorMsg);
                    completeRow(batchId, row, (res.header != null) ? res.header.id : "EXISTING");
                } else {
                    ProcessingLogEntry.log(batchId, "ERROR",
                            String.format("Row %d failed: %s | Payload: %s",
                                    row.lineNumber, errorMsg, payloadJson));
                    failRow(batchId, row, errorMsg);
                }
            }
        } catch (Exception ex) {
            Log.errorf(ex, "%s EXCEPTION: %s", ctx, extractErrorMessage(ex));
            failRow(batchId, row, extractErrorMessage(ex));
        }
    }

    // ── Row state transitions ─────────────────────────────────────────────────

    public void completeRow(ObjectId batchId, BatchData row, String ref) {
        try {
            if (RowResult.count("batchId = ?1 and lineNumber = ?2", batchId, row.lineNumber) == 0)
                new RowResult(batchId, row.lineNumber, "SUCCESS", ref, null).persist();
        } catch (Exception ignored) {
        }
        BatchData.update("processingStatus = 'COMPLETED'")
                .where("_id = ?1 and processingStatus != 'COMPLETED'", row.id);
    }

    private void failRow(ObjectId batchId, BatchData row, String err) {
        try {
            if (RowResult.count("batchId = ?1 and lineNumber = ?2", batchId, row.lineNumber) == 0)
                new RowResult(batchId, row.lineNumber, "FAILED", null, err).persist();
        } catch (Exception ignored) {
        }
        try {
            BatchData.update("processingStatus = 'FAILED'")
                    .where("_id = ?1 and processingStatus = 'CLAIMED'", row.id);
        } catch (Exception e) {
            Log.warnf(e, "[%s|Row:%d] REV failRow update failed — will be force-failed after join()",
                    batchId, row.lineNumber);
        }
    }

    // ── Finalization ──────────────────────────────────────────────────────────

    private void finalizeBatch(ObjectId batchId) {
        long total = BatchData.count("batchId", batchId);
        if (total == 0) return;

        long completed = BatchData.count(
                "batchId = ?1 and processingStatus = ?2", batchId, "COMPLETED");

        // Count all failure-class states for backward compat with existing data
        // (FAILED_PERMANENT and NO_RESPONSE existed in earlier versions)
        long failed = BatchData.count(
                "batchId = ?1 and processingStatus in ?2",
                batchId, List.of("FAILED", "FAILED_PERMANENT", "NO_RESPONSE"));

        // Not all rows resolved yet — rows still in PENDING or CLAIMED
        if (completed + failed < total) {
            Log.debugf("[%s] REV not ready: %d/%d done (success=%d fail=%d)",
                    batchId, completed + failed, total, completed, failed);
            return;
        }

        // Every row is either COMPLETED or FAILED — pick the batch's final status
        String status;
        if (failed == 0) status = FileBatch.STATUS_PROCESSED;
        else if (completed > 0) status = FileBatch.STATUS_PROCESSED_PARTIAL;
        else status = FileBatch.STATUS_PROCESSED_FAILED;

        // Atomic write — native MongoDB driver
        long updated = FileBatch.mongoCollection().updateOne(
                Filters.and(
                        Filters.eq("_id", batchId),
                        Filters.eq("status", FileBatch.STATUS_PROCESSING)
                ),
                Updates.combine(
                        Updates.set("status", status),
                        Updates.set("processingTimestamp", Instant.now())
                )
        ).getModifiedCount();

        if (updated == 0) {
            Log.warnf("[%s] REV finalize skipped — batch status already changed", batchId);
            return;
        }

        // Persist stats for reports
        BatchStatistics stats = new BatchStatistics();
        stats.id = batchId;
        stats.totalRecords = total;
        stats.successCount = completed;
        stats.failureCount = failed;
        stats.batchStatus = status;
        stats.lastUpdatedAt = Instant.now();
        stats.persistOrUpdate();

        Log.infof("[%s] REV FINALIZED → %s | total=%d success=%d failure=%d",
                batchId, status, total, completed, failed);

        sendBatchCompletionAsync(batchId, status, stats);
    }

    // ── Email ─────────────────────────────────────────────────────────────────

    private void sendBatchCompletionAsync(ObjectId batchId, String status, BatchStatistics stats) {
        try {
            FileBatch batch = FileBatch.findById(batchId);
            if (batch == null) return;

            AppUser uploader = AppUser.findByUsername(batch.uploadedById).orElse(null);
            if (uploader == null || uploader.email == null || uploader.email.isBlank()) return;

            final String toEmail = uploader.email;
            final String username = uploader.getUsername();
            final String filename = batch.originalFilename != null
                    ? batch.originalFilename : batchId.toHexString();
            final String appLabel = getAppLabel(batch.applicationId);
            final String url = baseUrl + "/batches";
            final long total = stats.totalRecords;
            final long success = stats.successCount;
            final long failure = stats.failureCount;

            managedExecutor.runAsync(() -> {
                try {
                    emailService.sendBatchCompletion(
                            toEmail, username, filename, appLabel,
                            status, total, success, failure, url);
                } catch (Exception e) {
                    Log.warnf(e, "[%s] REV completion email failed for %s", batchId, toEmail);
                }
            });
        } catch (Exception e) {
            Log.warnf(e, "[%s] REV error preparing completion email", batchId);
        }
    }

    private String getAppLabel(ObjectId appId) {
        if (appId == null) return "N/A";
        try {
            Application app = Application.findById(appId);
            return app != null ? app.name : "N/A";
        } catch (Exception e) {
            return "N/A";
        }
    }

    // ── Utilities ─────────────────────────────────────────────────────────────

    private String extractErrorMessage(Throwable t) {
        if (t == null) return "Unknown error";
        if (t instanceof WebApplicationException w && w.getResponse() != null) {
            try (Response resp = w.getResponse()) {
                String body = resp.readEntity(String.class);
                if (body != null && !body.isBlank()) {
                    String err = objectMapper.readValue(body, ProcessingResponse.class).getErrorMessage();
                    if (err != null) return err;
                }
            } catch (Exception ignored) {
            }
        }
        return Optional.ofNullable(t.getMessage()).orElse(t.getClass().getSimpleName());
    }

    private String getT24Reference(Map<String, Object> data) {
        if (data == null) return null;
        Object v = data.get("T24.REFERENCE");
        return v != null ? v.toString().trim() : null;
    }
}
