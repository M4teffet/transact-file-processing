package com.api.client;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.math.BigDecimal;

/**
 * DTO representing a single Financial Transaction Request.
 * Specifically structured for FUNDS_TRANSFER and extensible for DATA_CAPTURE.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public class TransactionRequest {

    @JsonProperty("body")
    public RequestBody body = new RequestBody();

    @JsonInclude(JsonInclude.Include.NON_NULL)
    public static class RequestBody {

        public String transactionType;
        public String paymentDetails;
        public String processingDate;
        public String exposureDate;

        // --- Debit Leg (Origin) ---
        public String debitAcctNo;
        public String debitCurrency;
        public BigDecimal debitAmount;
        public String debitValueDate;
        public String debitTheirRef;

        // --- Credit Leg (Destination) ---
        public String creditAcctNo;
        public String creditCurrency;
        public BigDecimal creditAmount;
        public String creditValueDate;
        public String creditTheirRef;

        // --- Customer & Bank Info ---
        public String orderingCust;
        public String orderingBank;

        // --- Fees, Commissions & Charges ---
        public String commissionCode;
        public String commissionType;
        public BigDecimal commissionAmt;
        public String chargeCode;
        public String chargeType;
        public BigDecimal chargeAmt;

        // --- Internal Accounting/Audit ---
        public String profitCentreCust;
        public String profitCentreDept;
    }
}