package com.api.client;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import io.quarkus.runtime.annotations.RegisterForReflection;

/**
 * DTO representing a single SICA (Système Interbancaire de Compensation Automatisée)
 * interbank / "confrère" transfer request sent to the OBA Mobile API gateway
 * (POST {funds-transfer-uemoa-api}/sicaTransfer).
 * <p>
 * The wire contract mirrors the confirmed gateway payload exactly:
 * <pre>
 * {
 *   "body": {
 *     "requestId": "...",
 *     "debitAccountId": "...",
 *     "transactionAmount": "...",
 *     "beneficiaryAccountId": "...",
 *     "beneficiaryName": "...",
 *     "beneficiaryAddress": "...",
 *     "transactionDescription": "...",
 *     "transactionObject": "..."
 *   }
 * }
 * </pre>
 * NON_NULL is applied so any optional field left blank in the CSV is simply
 * omitted rather than sent as {@code null}.
 */
@RegisterForReflection
@JsonInclude(JsonInclude.Include.NON_NULL)
public class SicaTransferRequest {

    @JsonProperty("body")
    public Body body = new Body();

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class Body {

        /** Client-side unique request id — used as the idempotency key (T24: L.MAPP.REQ.ID). */
        public String requestId;

        /** Ordering (debit) account number (T24: DEBIT.ACCT.NO). */
        public String debitAccountId;

        /** Transaction amount, sent as a string per the gateway contract (T24: DEBIT.AMOUNT). */
        public String transactionAmount;

        /** Beneficiary account / IBAN at the confrère bank (T24: L.BEN.ACC.NO). */
        public String beneficiaryAccountId;

        /** Beneficiary name (T24: L.BEN.NAME). */
        public String beneficiaryName;

        /** Beneficiary address (T24: L.BEN.ADDR). */
        public String beneficiaryAddress;

        /** Free-text payment details / label (T24: PAYMENT.DETAILS). */
        public String transactionDescription;

        /** Economic motive / object code, e.g. "400" (T24: L.FT.MOTIF.ECO). */
        public String transactionObject;
    }
}
