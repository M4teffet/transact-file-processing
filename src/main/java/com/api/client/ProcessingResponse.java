package com.api.client;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.ArrayList;
import java.util.List;

/**
 * Main response model for processing FT transactions
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public class ProcessingResponse {

    public ResponseHeader header;        // Always present
    public TransactionBody body;         // Present on success (HTTP 200/201)
    public ErrorBlock error;             // Business error (HTTP 400)
    public OverrideBlock override;       // Override errors (restrictions / posting issues)

    /**
     * Check if the response is fully successful
     */
    public boolean isSuccessful() {
        return (error == null || error.errorDetails == null || error.errorDetails.isEmpty()) &&
                (override == null || override.overrideDetails == null || override.overrideDetails.isEmpty());
    }

    /**
     * Retrieve the first error message found (business or override)
     */
    public String getErrorMessage() {
        String msg = null;

        // 1. Check for Business Errors
        if (error != null && error.errorDetails != null && !error.errorDetails.isEmpty()) {
            msg = error.errorDetails.get(0).message;
        }
        // 2. Fallback to Overrides
        else if (override != null && override.overrideDetails != null && !override.overrideDetails.isEmpty()) {
            msg = override.overrideDetails.get(0).description;
        }

        // 3. Logic to append the Transaction ID for duplicates
        if (msg != null && msg.contains("already Exists") && header != null && header.id != null) {
            return msg + " (ID: " + header.id + ")";
        }

        return msg;
    }

    /**
     * Retrieve all error messages (business + override)
     */
    public List<String> getAllErrorMessages() {
        List<String> messages = new ArrayList<>();

        if (error != null && error.errorDetails != null) {
            error.errorDetails.forEach(e -> messages.add(e.message));
        }
        if (override != null && override.overrideDetails != null) {
            override.overrideDetails.forEach(o -> messages.add(o.description));
        }
        return messages;
    }
}

/**
 * Business error block
 */
@JsonIgnoreProperties(ignoreUnknown = true)
class ErrorBlock {

    @JsonProperty("type")
    public String type;

    @JsonProperty("errorDetails")
    public List<ErrorDetail> errorDetails;
}

@JsonIgnoreProperties(ignoreUnknown = true)
class ErrorDetail {

    @JsonProperty("fieldName")
    public String fieldName;

    @JsonProperty("code")
    public String code;

    @JsonProperty("message")
    public String message;
}

/**
 * Override error block (restrictions / posting issues)
 */
@JsonIgnoreProperties(ignoreUnknown = true)
class OverrideBlock {

    @JsonProperty("overrideDetails")
    public List<OverrideDetail> overrideDetails;
}

@JsonIgnoreProperties(ignoreUnknown = true)
class OverrideDetail {

    @JsonProperty("code")
    public String code;

    @JsonProperty("description")
    public String description;

    @JsonProperty("id")
    public String id;

    @JsonProperty("type")
    public String type;
}
