package com.transact.scheduler;

import com.api.client.*;
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
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static io.quarkus.scheduler.Scheduled.ConcurrentExecution.SKIP;

/**
 * VirementSalaireProcessor — bulk payroll engine.
 * <p>
 * Two gated steps per batch (see docs/VIREMENT_SALAIRE_SPEC.md):
 * <ol>
 *   <li><b>Step 1 (global, gate)</b>: debit the company account (from the file name)
 *       and credit the transit account for the net total {@code Z}; if fees apply,
 *       a second leg debits the company and credits the fee-income account for
 *       {@code A − Z}. Step 1a must succeed before any disbursement.</li>
 *   <li><b>Step 2 (disbursement)</b>: from the transit account, pay each beneficiary
 *       the net amount — internal beneficiaries via FT, external via SICA.</li>
 * </ol>
 * Batches are naturally serialized (sequential batch loop + {@code SKIP}), which
 * satisfies the shared-transit requirement. All references are deterministic so a
 * crash-resume is idempotent.
 */
@ApplicationScoped
public class VirementSalaireProcessor {

    private static final String FEATURE_KEY = "VIREMENT_SALAIRE";
    private static final Pattern FILENAME =
            Pattern.compile("^VIR_([A-Za-z0-9]+)_(\\d{8})_(\\d{3})\\.csv$", Pattern.CASE_INSENSITIVE);

    @ConfigProperty(name = "app.base-url", defaultValue = "http://localhost:8080")
    String baseUrl;

    @Inject
    com.transact.service.VirementSalaireBillingService billingService;
    @Inject
    EmailService emailService;
    @Inject
    ObjectMapper objectMapper;
    @Inject
    ManagedExecutor managedExecutor;
    @Inject
    @RestClient
    ProcessingFt processingFt;
    @Inject
    @RestClient
    ProcessingSica processingSica;
    @Inject
    @RestClient
    ProcessingSicaSn processingSicaSn;

    // ── Scheduler ─────────────────────────────────────────────────────────────

    @Scheduled(every = "1m", identity = "virement-salaire-processor", concurrentExecution = SKIP)
    @ActivateRequestContext
    public void run() {
        Application app = Application.findByName(FEATURE_KEY);
        if (app == null) {
            ProcessingLogEntry.log("ERROR", "[VIRSAL] Application config missing: " + FEATURE_KEY);
            return;
        }
        if (!AppFeatureConfig.isFeatureEnabled(FEATURE_KEY)) return;

        List<FileBatch> batches = FileBatch.list(
                "status in :statuses and applicationId = :appId",
                Parameters.with("statuses", List.of(FileBatch.STATUS_VALIDATED, FileBatch.STATUS_PROCESSING))
                        .and("appId", app.id));
        if (batches.isEmpty()) return;

        Log.infof("[VIRSAL] %d batch(es) to process", batches.size());
        for (FileBatch batch : batches) {
            try {
                processBatch(batch.id);
            } catch (Exception e) {
                Log.errorf(e, "[%s] VIRSAL CRITICAL_BATCH_FAILURE: %s", batch.id, e.getMessage());
                ProcessingLogEntry.log(batch.id, "ERROR", "CRITICAL_BATCH_FAILURE: " + e.getMessage());
            }
        }
    }

    // ── Batch processing ──────────────────────────────────────────────────────

    private void processBatch(ObjectId batchId) {
        FileBatch batch = FileBatch.findById(batchId);
        if (batch == null) return;

        // Country / company
        String country = AppUser.findByUsername(batch.validatedById).map(AppUser::getCountryCode).orElse(null);
        if (country == null) {
            Log.errorf("[%s] VIRSAL validator country not found", batchId);
            return;
        }
        String companyId = Country.findByCode(country);
        if (companyId == null) {
            Log.errorf("[%s] VIRSAL company id not found for country %s", batchId, country);
            return;
        }

        // File name → debit account + value date + batch reference
        Matcher m = (batch.originalFilename != null) ? FILENAME.matcher(batch.originalFilename) : null;
        if (m == null || !m.matches()) {
            failWholeBatch(batchId, "Invalid file name (expected VIR_DEBITACCTNO_YYYYMMDD_INDEX.csv): " + batch.originalFilename);
            return;
        }
        String debitAcctNo = m.group(1);
        String valueDate = m.group(2);
        String batchRef = "VIR-" + debitAcctNo + "-" + valueDate + "-" + m.group(3);

        // Fully DB-driven config (no application.properties)
        VirementSalaireSettings settings = VirementSalaireSettings.get();

        // Transit account (admin-managed, per company)
        String transitAccount = VirementSalaireConfig.transitAccountFor(companyId);
        String internalPrefix = settings.internalPrefixFor(country);
        if (transitAccount == null) {
            // Configuration error, not a data error → leave the batch VALIDATED so it
            // resumes automatically once the transit account is set (Settings → Paie).
            Log.errorf("[%s] No transit account configured for company %s — batch left VALIDATED "
                    + "(set it in Settings → Paie)", batchId, companyId);
            ProcessingLogEntry.log(batchId, "ERROR",
                    "Compte de transit non configuré pour la société " + companyId
                    + " — configurez-le (Paramètres → Paie) ; le lot repartira automatiquement.");
            return;
        }

        String billingMode = (batch.billingMode != null) ? batch.billingMode : settings.billingDefaultMode;
        BigDecimal flatFee = (batch.flatFeeAmount != null) ? batch.flatFeeAmount : settings.flatFeeDefault;
        boolean isSenegal = settings.snCountryCode != null && settings.snCountryCode.equalsIgnoreCase(country);

        recoverRows(batchId);

        // Claim the batch: VALIDATED|PROCESSING → PROCESSING
        long updated = FileBatch.mongoCollection().updateOne(
                Filters.and(Filters.eq("_id", batchId),
                        Filters.in("status", FileBatch.STATUS_VALIDATED, FileBatch.STATUS_PROCESSING)),
                Updates.combine(Updates.set("status", FileBatch.STATUS_PROCESSING),
                        Updates.set("processingTimestamp", Instant.now()))
        ).getModifiedCount();
        if (updated == 0) return;

        List<BatchData> rows = BatchData.findByBatchId(batchId);
        if (rows.isEmpty()) {
            finalizeBatch(batchId, BigDecimal.ZERO);
            return;
        }

        // ── Control totals (same computation the user approved via /billing) ──
        var billing = billingService.compute(rows, billingMode, flatFee, internalPrefix);
        BigDecimal z = billing.netTotalZ;
        int externalCount = billing.externalCount;
        BigDecimal fees = billing.feesTotal;
        BigDecimal a = billing.grandTotalA;

        ProcessingLogEntry.log(batchId, "INFO", String.format(
                "VIRSAL %s | mode=%s Z=%s X=%d fees=%s A=%s transit=%s debit=%s",
                batchRef, billingMode, z.toPlainString(), externalCount, fees.toPlainString(),
                a.toPlainString(), transitAccount, debitAcctNo));

        // ── Step 1 (gate): company → transit for Z. For paying modes, the fees
        //    are charged on the same movement via T24 commission
        //    (COMMISSION.CODE = "DEBIT PLUS CHARGES", COMMISSION.AMT = fees),
        //    so the company is debited Z + fees and the transit receives exactly Z. ──
        if (!batch.virsalStep1Done) {
            TransactionRequest s1req = buildFt(settings, debitAcctNo, transitAccount, z,
                    batchRef, null, valueDate);   // no debitTheirRef on the first FT
            boolean charged = fees.compareTo(BigDecimal.ZERO) > 0;
            if (charged) {
                s1req.body.commissionCode = settings.commissionCode;   // e.g. "DEBIT PLUS CHARGES"
                s1req.body.commissionAmt = fees;              // amount to be paid
            }

            String s1payload = serialize(s1req);
            CallOutcome s1 = callFt(s1req, batchRef + "-S1", companyId, "[" + batchId + "|S1]", s1payload);
            if (!s1.ok) {
                ProcessingLogEntry.log(batchId, "ERROR",
                        "VIRSAL step1 (company→transit) failed: " + s1.error
                        + " | Payload: " + s1payload + " | Response: " + s1.raw);
                failWholeBatch(batchId, "Step 1 failed: " + s1.error);
                return;
            }
            FileBatch.mongoCollection().updateOne(Filters.eq("_id", batchId),
                    Updates.combine(Updates.set("virsalStep1Done", true),
                            Updates.set("virsalStep1Ref", s1.ref),
                            Updates.set("virsalFeeCollected", charged ? Boolean.TRUE : null)));
            Log.infof("[%s] VIRSAL step1 OK: %s | fees=%s (%s)",
                    batchId, s1.ref, fees.toPlainString(), charged ? settings.commissionCode : "free");
        }

        // ── Step 2 (disbursement) ──────────────────────────────────────────
        List<BatchData> pending = BatchData.findPendingByBatchId(batchId);
        Semaphore limiter = new Semaphore(Math.max(1, settings.maxThreads));
        List<CompletableFuture<Void>> futures = new ArrayList<>();
        String workerId = UUID.randomUUID().toString();

        for (BatchData row : pending) {
            try {
                limiter.acquire();
                futures.add(CompletableFuture.runAsync(() -> {
                    try {
                        disburse(row, workerId, batchId, companyId, transitAccount,
                                internalPrefix, batchRef, valueDate, isSenegal);
                    } catch (Exception e) {
                        Log.errorf(e, "[%s|Row:%d] VIRSAL unexpected error — forcing FAILED", batchId, row.lineNumber);
                        BatchData.update("processingStatus = 'FAILED'")
                                .where("_id = ?1 and processingStatus = 'CLAIMED'", row.id);
                    } finally {
                        limiter.release();
                    }
                }, managedExecutor));
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
        }
        if (!futures.isEmpty()) {
            try {
                CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).join();
            } catch (Exception ignored) {
            }
        }

        BatchData.update("processingStatus = 'FAILED'")
                .where("batchId = ?1 and processingStatus = 'CLAIMED'", batchId);

        finalizeBatch(batchId, z);
    }

    // ── Disbursement (one beneficiary) ─────────────────────────────────────────

    private void disburse(VirementSalaireSettings settings, BatchData row, String workerId, ObjectId batchId, String companyId,
                          String transitAccount, String internalPrefix, String batchRef,
                          String valueDate, boolean isSenegal) {
        if (!BatchData.claimRow(row.id, workerId)) return;

        String ctx = String.format("[%s|Row:%d]", batchId, row.lineNumber);
        String rowRef = batchRef + "-R" + row.lineNumber;                 // full, for logs/correlation
        String reqId = requestId(batchRef, row.lineNumber, settings.requestIdMaxLength); // short, for T24
        String benAcct = beneficiaryAcct(row);
        BigDecimal amt = amount(row);
        String details = str(row, "PAYMENT.DETAILS");
        boolean external = isExternal(benAcct, internalPrefix);
        String channel = external ? "SICA" : "FT";
        String payload;
        CallOutcome outcome;

        if (external) {
            // External → SICA (debit = transit, beneficiary gets the net amount)
            SicaTransferRequest req = new SicaTransferRequest();
            req.body.requestId = reqId;
            req.body.debitAccountId = transitAccount;
            req.body.transactionAmount = amt.toPlainString();
            req.body.beneficiaryAccountId = benAcct;
            req.body.beneficiaryName = str(row, "L.BEN.NAME");
            req.body.beneficiaryAddress = str(row, "L.BEN.ADDR");
            req.body.transactionDescription = details;
            String motif = str(row, "L.FT.MOTIF.ECO");
            req.body.transactionObject = (motif != null) ? motif : "400";
            payload = serialize(req);
            outcome = callSica(req, rowRef, companyId, isSenegal, ctx, payload);
        } else {
            // Internal → FT (transit → beneficiary)
            TransactionRequest req = buildFt(settings, transitAccount, benAcct, amt, details, reqId, valueDate);
            payload = serialize(req);
            outcome = callFt(req, rowRef, companyId, ctx, payload);
        }

        if (outcome.ok) {
            Log.infof("%s VIRSAL SUCCESS (%s): %s", ctx, external ? "ext" : "int", outcome.ref);
            completeRow(batchId, row, outcome.ref);
        } else {
            ProcessingLogEntry.log(batchId, "ERROR", String.format(
                    "Row %d failed [%s]: %s | Payload: %s | Response: %s",
                    row.lineNumber, channel, outcome.error, payload, outcome.raw));
            failRow(batchId, row, outcome.error);
        }
    }

    // ── T24 calls ──────────────────────────────────────────────────────────────

    private CallOutcome callFt(TransactionRequest req, String corr, String companyId, String ctx, String payload) {
        String url = urlFor("FT");
        Log.infof("%s → POST %s | corr=%s companyId=%s | request=%s", ctx, url, corr, companyId, payload);
        try {
            Response response;
            try {
                response = processingFt.processTransaction(req, corr, companyId);
            } catch (WebApplicationException e) {
                response = e.getResponse();
            }
            return parse(response, ctx, url);
        } catch (Exception e) {
            String err = extractErrorMessage(e);
            Log.errorf("%s ✗ EXCEPTION %s | %s", ctx, url, err);
            return CallOutcome.fail(err, null);
        }
    }

    private CallOutcome callSica(SicaTransferRequest req, String corr, String companyId, boolean isSenegal,
                                 String ctx, String payload) {
        String url = urlFor(isSenegal ? "SICA_SN" : "SICA");
        Log.infof("%s → POST %s | corr=%s companyId=%s | request=%s", ctx, url, corr, companyId, payload);
        try {
            Response response;
            try {
                response = isSenegal
                        ? processingSicaSn.sicaTransferSn(req, corr, companyId)
                        : processingSica.sicaTransfer(req, corr, companyId);
            } catch (WebApplicationException e) {
                response = e.getResponse();
            }
            return parse(response, ctx, url);
        } catch (Exception e) {
            String err = extractErrorMessage(e);
            Log.errorf("%s ✗ EXCEPTION %s | %s", ctx, url, err);
            return CallOutcome.fail(err, null);
        }
    }

    private CallOutcome parse(Response response, String ctx, String url) throws Exception {
        if (response == null) {
            Log.warnf("%s ← no response from %s", ctx, url);
            return CallOutcome.fail("No response from gateway", null);
        }
        try (Response resp = response) {
            int status = resp.getStatus();
            String body = resp.readEntity(String.class);
            Log.infof("%s ← HTTP %d %s | response=%s", ctx, status, url, body);
            if (body == null || body.isBlank()) return CallOutcome.fail("Empty response body (HTTP " + status + ")", body);
            ProcessingResponse res = objectMapper.readValue(body, ProcessingResponse.class);

            // Any error or override (structured block, or the literal token in the body) → FAILED.
            boolean problem = mentionsProblem(body);
            if (status < 400 && res.isSuccessful() && !problem) {
                return CallOutcome.ok(res.header != null ? res.header.id : "N/A", body);
            }
            String err = res.getErrorMessage();
            if (err == null && problem) err = "Response contains an error/override block";
            return CallOutcome.fail(err != null ? err : "HTTP " + status, body);
        }
    }

    /** A response mentioning an error or override block is treated as a failure. */
    private boolean mentionsProblem(String body) {
        if (body == null) return false;
        String b = body.toLowerCase();
        return b.contains("\"error\":") || b.contains("\"override\":");
    }

    /** Best-effort resolved endpoint URL for logging. */
    private String urlFor(String channel) {
        var c = org.eclipse.microprofile.config.ConfigProvider.getConfig();
        try {
            return switch (channel) {
                case "FT" -> c.getOptionalValue("quarkus.rest-client.\"funds-transfer-api\".url", String.class)
                        .orElse("funds-transfer-api") + "/process";
                case "SICA" -> c.getOptionalValue("quarkus.rest-client.\"funds-transfer-uemoa-api\".url", String.class)
                        .orElse("funds-transfer-uemoa-api") + "/sicaTransfer";
                case "SICA_SN" -> c.getOptionalValue("quarkus.rest-client.\"funds-transfer-uemoa-sn-api\".url", String.class)
                        .orElse("funds-transfer-uemoa-sn-api") + "/sicaTransferSn";
                default -> channel;
            };
        } catch (Exception e) {
            return channel;
        }
    }

    // ── FT request builder (internal legs) ──────────────────────────────────────

    private TransactionRequest buildFt(VirementSalaireSettings settings, String debitAcct, String creditAcct, BigDecimal amount,
                                       String details, String ref, String valueDate) {
        TransactionRequest req = new TransactionRequest();
        req.body.transactionType = settings.ftTransactionType;
        req.body.debitAcctNo = debitAcct;
        req.body.creditAcctNo = creditAcct;
        req.body.creditAmount = amount;
        req.body.creditCurrency = settings.currency;
        req.body.paymentDetails = details;
        req.body.orderingBank = settings.orderingBank;
        if (ref != null) req.body.debitTheirRef = ref;   // omitted for the Step 1 transit movement
        req.body.creditValueDate = valueDate;
        req.body.debitValueDate = valueDate;
        return req;
    }

    // ── Row state transitions ───────────────────────────────────────────────────

    private void completeRow(ObjectId batchId, BatchData row, String ref) {
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
        BatchData.update("processingStatus = 'FAILED'")
                .where("_id = ?1 and processingStatus = 'CLAIMED'", row.id);
    }

    private void recoverRows(ObjectId batchId) {
        long claimed = BatchData.update("processingStatus = 'PENDING', workerId = null")
                .where("batchId = :batchId and processingStatus = 'CLAIMED'",
                        Parameters.with("batchId", batchId));
        if (claimed > 0)
            Log.warnf("[%s] VIRSAL recovered %d CLAIMED row(s) → PENDING", batchId, claimed);
    }

    private void failWholeBatch(ObjectId batchId, String reason) {
        Log.errorf("[%s] VIRSAL %s", batchId, reason);
        ProcessingLogEntry.log(batchId, "ERROR", reason);
        FileBatch.mongoCollection().updateOne(
                Filters.and(Filters.eq("_id", batchId),
                        Filters.in("status", FileBatch.STATUS_VALIDATED, FileBatch.STATUS_PROCESSING)),
                Updates.combine(Updates.set("status", FileBatch.STATUS_PROCESSED_FAILED),
                        Updates.set("processingTimestamp", Instant.now())));
    }

    // ── Finalization + reconciliation ────────────────────────────────────────────

    private void finalizeBatch(ObjectId batchId, BigDecimal z) {
        long total = BatchData.count("batchId", batchId);
        if (total == 0) return;

        long completed = BatchData.count("batchId = ?1 and processingStatus = ?2", batchId, "COMPLETED");
        long failed = BatchData.count("batchId = ?1 and processingStatus in ?2",
                batchId, List.of("FAILED", "FAILED_PERMANENT", "NO_RESPONSE"));
        if (completed + failed < total) return;

        String status = (failed == 0) ? FileBatch.STATUS_PROCESSED
                : (completed > 0) ? FileBatch.STATUS_PROCESSED_PARTIAL
                : FileBatch.STATUS_PROCESSED_FAILED;

        long updated = FileBatch.mongoCollection().updateOne(
                Filters.and(Filters.eq("_id", batchId), Filters.eq("status", FileBatch.STATUS_PROCESSING)),
                Updates.combine(Updates.set("status", status), Updates.set("processingTimestamp", Instant.now()))
        ).getModifiedCount();
        if (updated == 0) return;

        // Reconciliation: disbursed (sum of successful rows) vs Z; stranded in transit
        List<BatchData> done = BatchData.list("batchId = ?1 and processingStatus = ?2", batchId, "COMPLETED");
        BigDecimal disbursed = done.stream().map(this::amount).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal stranded = z.subtract(disbursed);
        ProcessingLogEntry.log(batchId, stranded.signum() == 0 ? "INFO" : "WARN",
                String.format("VIRSAL reconciliation: Z=%s disbursed=%s stranded_in_transit=%s",
                        z.toPlainString(), disbursed.toPlainString(), stranded.toPlainString()));

        BatchStatistics stats = new BatchStatistics();
        stats.id = batchId;
        stats.totalRecords = total;
        stats.successCount = completed;
        stats.failureCount = failed;
        stats.batchStatus = status;
        stats.lastUpdatedAt = Instant.now();
        stats.persistOrUpdate();

        Log.infof("[%s] VIRSAL FINALIZED → %s | total=%d success=%d failure=%d",
                batchId, status, total, completed, failed);
        sendCompletionAsync(batchId, status, stats);
    }

    private void sendCompletionAsync(ObjectId batchId, String status, BatchStatistics stats) {
        try {
            FileBatch batch = FileBatch.findById(batchId);
            if (batch == null) return;
            AppUser uploader = AppUser.findByUsername(batch.uploadedById).orElse(null);
            if (uploader == null || uploader.email == null || uploader.email.isBlank()) return;
            final String to = uploader.email, user = uploader.getUsername();
            final String file = batch.originalFilename != null ? batch.originalFilename : batchId.toHexString();
            final String url = baseUrl + "/batches";
            final long t = stats.totalRecords, s = stats.successCount, f = stats.failureCount;
            managedExecutor.runAsync(() -> {
                try {
                    emailService.sendBatchCompletion(to, user, file, FEATURE_KEY, status, t, s, f, url);
                } catch (Exception e) {
                    Log.warnf(e, "[%s] VIRSAL completion email failed", batchId);
                }
            });
        } catch (Exception e) {
            Log.warnf(e, "[%s] VIRSAL error preparing completion email", batchId);
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────

    private boolean isExternal(String benAcct, String internalPrefix) {
        if (benAcct == null) return true;
        if (internalPrefix == null || internalPrefix.isBlank()) return true;
        return !benAcct.toUpperCase().startsWith(internalPrefix.toUpperCase());
    }

    private String beneficiaryAcct(BatchData row) {
        return str(row, "L.BEN.ACC.NO");
    }

    private BigDecimal amount(BatchData row) {
        String v = str(row, "CREDIT.AMOUNT");
        if (v == null) return BigDecimal.ZERO;
        try {
            return new BigDecimal(v.replace(",", ""));
        } catch (Exception e) {
            return BigDecimal.ZERO;
        }
    }

    private String str(BatchData row, String key) {
        if (row.data == null) return null;
        Object v = row.data.get(key);
        if (v == null) return null;
        String s = v.toString().trim();
        return s.isEmpty() ? null : s;
    }

    /** Serialize an outgoing T24 request for troubleshooting logs. */
    private String serialize(Object req) {
        try {
            return objectMapper.writeValueAsString(req);
        } catch (Exception e) {
            return "[serialization error: " + e.getMessage() + "]";
        }
    }

    /**
     * Deterministic idempotency reference that fits the T24 requestId field.
     * Returns the readable ref when short enough, otherwise a stable hash truncated
     * to {@code maxLen} (same row always yields the same id, so retries dedupe).
     */
    private String requestId(String batchRef, int line, int maxLen) {
        String full = batchRef + "-R" + line;
        if (maxLen <= 0 || full.length() <= maxLen) return full;
        String hex;
        try {
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-256");
            byte[] d = md.digest(full.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            for (byte b : d) sb.append(String.format("%02X", b));
            hex = sb.toString();
        } catch (Exception e) {
            hex = Integer.toHexString(full.hashCode()).toUpperCase();
        }
        String candidate = "P" + hex;
        return candidate.substring(0, Math.min(maxLen, candidate.length()));
    }

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

    /** Small result holder for a single T24 call. */
    private static final class CallOutcome {
        final boolean ok;
        final String ref;
        final String error;
        final String raw;   // raw response body, for troubleshooting

        private CallOutcome(boolean ok, String ref, String error, String raw) {
            this.ok = ok;
            this.ref = ref;
            this.error = error;
            this.raw = raw;
        }

        static CallOutcome ok(String ref, String raw) {
            return new CallOutcome(true, ref, null, raw);
        }

        static CallOutcome fail(String error, String raw) {
            return new CallOutcome(false, null, error, raw);
        }
    }
}
