package com.api.client;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonIgnoreProperties(ignoreUnknown = true)
public class ResponseHeader {
    @JsonProperty("id")
    public String id;

    @JsonProperty("status")
    public String status;

    @JsonProperty("transactionStatus")
    public String transactionStatus;
}
