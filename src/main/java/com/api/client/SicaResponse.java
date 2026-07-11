package com.api.client;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import io.quarkus.runtime.annotations.RegisterForReflection;

import java.util.ArrayList;
import java.util.List;

/**
 * Response model for the SICA {@code /sicaTransfer} endpoint.
 * <p>
 * Real success envelope returned by the OBA Mobile API gateway:
 * <pre>
 * {
 *   "header": { "id": "FT25347ZGMNR", "status": "success", "transactionStatus": "Live", "audit": {...} },
 *   "body":   { "transactionRef": "FT...", "paymentStatus": "01",
 *               "Override": "DUP.CONTRACT}Auto:POSSIBLE DUPLICATE CONTRACT ...{FT...", ... }
 * }
 * </pre>
 * Notes that shaped this model:
 * <ul>
 *   <li>{@code header.status} carries the outcome ("success"); {@code header.id} is the T24 reference.</li>
 *   <li>An <em>auto-accepted</em> override is reported as a <b>string inside {@code body}</b>
 *       ({@code body.Override}), <b>not</b> as a top-level {@code override} block. Because the
 *       transaction still succeeded, it must NOT be treated as a failure — only surfaced as info.</li>
 *   <li>A hard business rejection is still expected to arrive as a top-level {@code error}
 *       (and/or {@code override}) block, matching the other Temenos endpoints.</li>
 * </ul>
 * Lenient ({@code ignoreUnknown = true}) so unmodelled fields (audit, timings, etc.) never break parsing.
 */
@RegisterForReflection
@JsonIgnoreProperties(ignoreUnknown = true)
public class SicaResponse {

    public Header header;           // { id, status, transactionStatus, ... }
    public Body body;               // present on success
    public ErrorBlock error;        // top-level business errors (hard failures)
    public OverrideBlock override;  // top-level restriction / posting overrides (hard failures)

    // ── Lightweight mobapi envelope fallbacks (defensive) ────────────────────
    @JsonProperty("status")
    public String status;
    @JsonProperty("responseCode")
    public String responseCode;
    @JsonProperty("message")
    public String message;
    @JsonProperty("messages")
    public List<String> messages;

    private static boolean indicatesFailure(String s) {
        if (s == null || s.isBlank()) return false;
        String v = s.trim().toUpperCase();
        return v.equals("FAILED") || v.equals("FAILURE") || v.equals("ERROR")
                || v.equals("KO") || v.equals("REJECTED") || v.equals("DECLINED");
    }

    private static boolean indicatesSuccess(String s) {
        if (s == null || s.isBlank()) return false;
        String v = s.trim().toUpperCase();
        return v.equals("SUCCESS") || v.equals("OK") || v.equals("LIVE")
                || v.equals("00") || v.equals("0") || v.equals("1");
    }

    /**
     * A transfer is successful only when it actually posted in T24.
     * <p>
     * The gateway returns {@code header.status = "success"} exactly when the
     * transaction posts — which, for a transaction that raised an override, means
     * the override was <b>auto-accepted</b>. An override that is <b>not</b>
     * auto-accepted does not post, so the status will not be a success value and
     * this returns {@code false}. Any top-level {@code error}/{@code override}
     * block is likewise a hard failure. The in-body {@code Override} note alone
     * never flips a genuine "success" status to failure.
     */
    public boolean isSuccessful() {
        boolean noError = (error == null || error.errorDetails == null || error.errorDetails.isEmpty());
        boolean noOverrideBlock = (override == null || override.overrideDetails == null || override.overrideDetails.isEmpty());
        if (!noError || !noOverrideBlock) return false;

        String outcome = (header != null && header.status != null) ? header.status : status;
        if (indicatesFailure(outcome) || indicatesFailure(responseCode)) return false;
        if (indicatesSuccess(outcome)) return true;

        // No explicit status: only treat as success when nothing concerning is present
        // (in particular, an unresolved in-body override must NOT pass as success).
        return outcome == null && getOverrideNote() == null;
    }

    /**
     * Best-effort T24 reference for a successful transfer: header id, then body ref.
     */
    public String getReference() {
        if (header != null && header.id != null && !header.id.isBlank()) return header.id;
        if (body != null && body.transactionRef != null && !body.transactionRef.isBlank()) return body.transactionRef;
        return null;
    }

    /**
     * Informational auto-override note, if any (never a failure by itself).
     */
    public String getOverrideNote() {
        return (body != null) ? body.override : null;
    }

    /**
     * First available error message on failure (top-level error → override → mobapi message).
     * Appends the transaction id for duplicate/idempotency cases.
     */
    public String getErrorMessage() {
        String msg = null;

        if (error != null && error.errorDetails != null && !error.errorDetails.isEmpty()) {
            msg = error.errorDetails.get(0).message;
        } else if (override != null && override.overrideDetails != null && !override.overrideDetails.isEmpty()) {
            msg = override.overrideDetails.get(0).description;
        } else if (message != null && !message.isBlank()) {
            msg = message;
        } else if (messages != null && !messages.isEmpty()) {
            msg = messages.get(0);
        } else if (getOverrideNote() != null && !getOverrideNote().isBlank()) {
            // Non-auto-accepted override that blocked the transaction — surface it as the reason
            msg = getOverrideNote();
        }

        if (msg != null && (msg.contains("already Exists") || msg.toUpperCase().contains("DUPLICATE"))
                && header != null && header.id != null) {
            return msg + " (ID: " + header.id + ")";
        }
        return msg;
    }

    public List<String> getAllErrorMessages() {
        List<String> out = new ArrayList<>();
        if (error != null && error.errorDetails != null) {
            error.errorDetails.forEach(e -> out.add(e.message));
        }
        if (override != null && override.overrideDetails != null) {
            override.overrideDetails.forEach(o -> out.add(o.description));
        }
        if (messages != null) {
            out.addAll(messages);
        } else if (message != null && !message.isBlank()) {
            out.add(message);
        }
        return out;
    }

    @RegisterForReflection
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Header {
        public String id;
        public String status;
        public String transactionStatus;
    }

    /**
     * Subset of the success body we care about. Everything else is ignored.
     */
    @RegisterForReflection
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Body {
        public String transactionRef;
        public String requestId;
        public String paymentStatus;
        public String amountDebited;
        public String amountCredited;
        public String commissionAmount;

        /**
         * Auto-accepted override note (informational only; the txn still succeeded).
         */
        @JsonProperty("Override")
        public String override;
    }
}
