package com.api.client;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonIgnoreProperties(ignoreUnknown = true)
public class TransactionBody {
    // This field maps to the "transactionRef" used in your Processor
    @JsonProperty("transactionRef")
    public String transactionRef;

    public String debitValueDate;
    public String debitCurrency;
    public String processingDate;
    public String creditValueDate;
    public String transactionType;
    public String profitCentreCust;
    public String creditAcctNo;
    public String creditCurrency;
    public String commissionCode;
    public String creditAmount;
    public String paymentDetails;
    public String debitAcctNo;
    public String chargeCode;
}
