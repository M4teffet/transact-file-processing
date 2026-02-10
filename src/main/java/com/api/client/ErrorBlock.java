package com.api.client;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * Business error block
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class ErrorBlock {

    @JsonProperty("type")
    public String type;

    @JsonProperty("errorDetails")
    public List<ErrorDetail> errorDetails;
}
