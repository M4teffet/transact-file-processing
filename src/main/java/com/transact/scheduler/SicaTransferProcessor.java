package com.transact.scheduler;

import com.api.client.ProcessingResponse;
import com.api.client.ProcessingSica;
import com.api.client.ProcessingSicaSn;
import com.api.client.SicaTransferRequest;
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

import java.math.BigDecimal;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicInteger;

import static io.quarkus.scheduler.Scheduled.ConcurrentExecution.SKIP;

/**
 * SicaTransferProcessor — background engine for SICA ("confrère" / interbank)
 * transfers. Structurally identical to {@link FundsTransferProcessor}: it picks
 * up VALIDATED (or crash-interrupted PROCESSING) batches for the SICA_TRANSFER
 * application, maps each row to the gateway payload, submits it to
 * {@code /sicaTransfer}, and finalizes the batch.
 */
@ApplicationScoped
public class SicaTransferProcessor {

    private static final String FEATURE_KEY = "SICA_TRANSFER";

    private final AtomicInteger activeProcessors = new AtomicInteger(0);

    @ConfigProperty(name = "sica.processor.max-threads", defaultValue = "2")
    int maxThreads;

    @ConfigProperty(name = "app.base-url", defaultValue = "http://localhost:8080")
    String baseUrl;

    /**
     * ISO country code routed to the Senegal-specific SICA endpoint.
     */
    @ConfigProperty(name = "sica.sn.country-code", defaultValue = "SN")
    String snCountryCode;

    @Inject
    EmailService emailService;
    @Inject
    @RestClient
    ProcessingSica processingSica;
    @Inject
    @RestClient
    ProcessingSicaSn processingSicaSn;
    @Inject
    ObjectMapper objectMapper;
    @Inject
    ManagedExecutor managedExecutor;

    // ── Scheduler ─────────────────────────────────────────────────────────────

    @Scheduled(every = "1m", identity = "sica-processor", concurrentExecution = SKIP)
    @ActivateRequestContext
    public void run() {
        Application app = Application.findByName(FEATURE_KEY);
        if (app == null) {
            Log.errorf("[SICA] Application config missing for key: %s", FEATURE_KEY);
            ProcessingLogEntry.log("ERROR", "[SICA] Application config missing: " + FEATURE_KEY);
            return;
        }

        if (!AppFeatureConfig.isFeatureEnabled(FEATURE_KEY)) {
            Log.debugf("%s processing disabled", FEATURE_KEY);
            return;
        }

        // VALIDATED = new batch ready to run
        // PROCESSING = batch was mid-flight when the system failed — resume it
        List<FileBatch> batches = FileBatch.list(
                "status in :statuses and applicationId = :appId",
                Parameters.with("statuses", List.of(FileBatch.STATUS_VALIDATED, FileBatch.STATUS_PROCESSING))
                        .and("appId", app.id)
        );

        if (batches.isEmpty()) return;

        Log.infof("[SICA] %d batch(es) to process", batches.size());

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

            // Senegal SICA uses a dedicated gateway (different base URL + /sicaTransferSn)
            final boolean isSenegal = snCountryCode.equalsIgnoreCase(country);
            if (isSenegal) {
                Log.infof("[%s] SICA routing: Senegal endpoint (country=%s)", batchId, country);
            }

            // On restart, rows left CLAIMED were mid-flight when the JVM died.
            // Reset them to PENDING for retry — a crash is not a failure.
            recoverRows(batchId);

            // Atomic transition VALIDATED|PROCESSING → PROCESSING (native driver).
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

            List<BatchData> rows = BatchData.findPendingByBatchId(batchId);

            if (rows.isEmpty()) {
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
                            processRow(row, workerId, batchId, companyId, isSenegal);
                        } catch (Exception e) {
                            Log.errorf(e, "[%s|Row:%d] SICA unexpected error in processRow — forcing FAILED",
                                    batchId, row.lineNumber);
                            try {
                                BatchData.update("processingStatus = 'FAILED'")
                                        .where("_id = ?1 and processingStatus = 'CLAIMED'", row.id);
                            } catch (Exception ex2) {
                                Log.errorf(ex2, "[%s|Row:%d] SICA safety-net update also failed",
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
                    Log.warnf("[%s] SICA one or more futures completed exceptionally: %s",
                            batchId, e.getMessage());
                }
            }

            long orphaned = BatchData.update("processingStatus = 'FAILED'")
                    .where("batchId = ?1 and processingStatus = 'CLAIMED'", batchId);
            if (orphaned > 0)
                Log.warnf("[%s] SICA force-failed %d orphaned CLAIMED row(s)", batchId, orphaned);

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
            Log.warnf("[%s] SICA recovered %d CLAIMED row(s) → PENDING (system restart)", batchId, claimed);
            ProcessingLogEntry.log(batchId, "WARN",
                    String.format("Récupération SICA après redémarrage : %d ligne(s) relancée(s)", claimed));
        }
    }

    // ── Row-level processing ──────────────────────────────────────────────────

    private void processRow(BatchData row, String workerId, ObjectId batchId, String companyId, boolean isSenegal) {
        if (!BatchData.claimRow(row.id, workerId)) return;

        String ctx = String.format("[%s|Row:%d]", batchId, row.lineNumber);
        String correlationId = batchId + "-" + row.lineNumber;
        SicaTransferRequest req = mapToRequest(row.data);
        String payloadJson = serializePayload(req);
        Response response = null;

        try {
            try {
                response = isSenegal
                        ? processingSicaSn.sicaTransferSn(req, correlationId, companyId)
                        : processingSica.sicaTransfer(req, correlationId, companyId);
            } catch (WebApplicationException e) {
                response = e.getResponse();
            }

            if (response == null) {
                failRow(batchId, row, "No response from SICA gateway");
                return;
            }

            try (Response resp = response) {
                String body = resp.readEntity(String.class);

                if (body == null || body.isBlank()) {
                    failRow(batchId, row, "Empty response body from SICA gateway");
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

                // Idempotency: already processed → count as success
                if (errorMsg != null && errorMsg.contains("already Exists")) {
                    Log.warnf("%s IDEMPOTENCY: %s", ctx, errorMsg);
                    completeRow(batchId, row, (res.header != null) ? res.header.id : "EXISTING");
                } else {
                    String err = errorMsg != null ? errorMsg : "HTTP " + resp.getStatus();
                    ProcessingLogEntry.log(batchId, "ERROR",
                            String.format("Row %d failed: %s | Payload: %s", row.lineNumber, err, payloadJson));
                    failRow(batchId, row, err);
                }
            }

        } catch (Exception ex) {
            String err = extractErrorMessage(ex);
            Log.errorf(ex, "%s EXCEPTION: %s", ctx, err);
            failRow(batchId, row, err);
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
            Log.warnf(e, "[%s|Row:%d] SICA failRow update failed — will be force-failed after join()",
                    batchId, row.lineNumber);
        }
    }

    // ── Finalization ──────────────────────────────────────────────────────────

    private void finalizeBatch(ObjectId batchId) {
        long total = BatchData.count("batchId", batchId);
        if (total == 0) return;

        long completed = BatchData.count(
                "batchId = ?1 and processingStatus = ?2", batchId, "COMPLETED");

        long failed = BatchData.count(
                "batchId = ?1 and processingStatus in ?2",
                batchId, List.of("FAILED", "FAILED_PERMANENT", "NO_RESPONSE"));

        if (completed + failed < total) {
            Log.debugf("[%s] SICA not ready: %d/%d done (success=%d fail=%d)",
                    batchId, completed + failed, total, completed, failed);
            return;
        }

        String status;
        if (failed == 0) status = FileBatch.STATUS_PROCESSED;
        else if (completed > 0) status = FileBatch.STATUS_PROCESSED_PARTIAL;
        else status = FileBatch.STATUS_PROCESSED_FAILED;

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
            Log.warnf("[%s] SICA finalize skipped — batch status already changed", batchId);
            return;
        }

        BatchStatistics stats = new BatchStatistics();
        stats.id = batchId;
        stats.totalRecords = total;
        stats.successCount = completed;
        stats.failureCount = failed;
        stats.batchStatus = status;
        stats.lastUpdatedAt = Instant.now();
        stats.persistOrUpdate();

        Log.infof("[%s] SICA FINALIZED → %s | total=%d success=%d failure=%d",
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
                    Log.warnf(e, "[%s] SICA completion email failed for %s", batchId, toEmail);
                }
            });
        } catch (Exception e) {
            Log.warnf(e, "[%s] SICA error preparing completion email", batchId);
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

    // ── Mapping & utilities ────────────────────────────────────────────────────

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

    /**
     * Maps a CSV row (T24 field names) to the SICA gateway payload.
     * <p>
     * requestId falls back from L.MAPP.REQ.ID to L.TXN.REF so every row carries
     * a stable idempotency key even if the primary column is empty.
     */
    private SicaTransferRequest mapToRequest(Map<String, Object> data) {
        SicaTransferRequest r = new SicaTransferRequest();
        r.body = new SicaTransferRequest.Body();
        if (data == null) return r;

        r.body.requestId = firstNonBlank(str(data, "L.MAPP.REQ.ID"), str(data, "L.TXN.REF"));
        r.body.debitAccountId = str(data, "DEBIT.ACCT.NO");
        r.body.transactionAmount = normalizeAmount(str(data, "DEBIT.AMOUNT"));
        r.body.beneficiaryAccountId = str(data, "L.BEN.ACC.NO");
        r.body.beneficiaryName = str(data, "L.BEN.NAME");
        r.body.beneficiaryAddress = str(data, "L.BEN.ADDR");
        r.body.transactionDescription = str(data, "PAYMENT.DETAILS");
        r.body.transactionObject = str(data, "L.FT.MOTIF.ECO");

        return r;
    }

    private String serializePayload(SicaTransferRequest req) {
        try {
            return objectMapper.writeValueAsString(req);
        } catch (Exception e) {
            return "[Serialization Error]";
        }
    }

    private String str(Map<String, Object> data, String key) {
        Object v = data.get(key);
        if (v == null) return null;
        String s = v.toString().trim();
        return s.isEmpty() ? null : s;
    }

    private String firstNonBlank(String a, String b) {
        if (a != null && !a.isBlank()) return a;
        if (b != null && !b.isBlank()) return b;
        return null;
    }

    /**
     * The gateway expects the amount as a plain string. Strip grouping commas and
     * render without scientific notation / trailing artefacts.
     */
    private String normalizeAmount(String val) {
        if (val == null) return null;
        try {
            return new BigDecimal(val.replace(",", "")).stripTrailingZeros().toPlainString();
        } catch (Exception e) {
            return val;
        }
    }
}
