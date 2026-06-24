package com.transact.dto;

import java.time.Instant;
import java.util.List;

/**
 * Standardised error body returned by every API endpoint on non-2xx status.
 * <p>
 * {
 * "error":     "NOT_FOUND",
 * "message":   "Lot non trouvé",
 * "details":   [],
 * "timestamp": "2026-06-21T14:00:00Z",
 * "path":      "/api/v1/batches/abc123"
 * }
 */
public record ApiError(
        String error,
        String message,
        List<FieldDetail> details,
        Instant timestamp,
        String path
) {
    /**
     * Convenience — no field-level details
     */
    public static ApiError of(String error, String message, String path) {
        return new ApiError(error, message, List.of(), Instant.now(), path);
    }

    /**
     * With field-level validation details
     */
    public static ApiError of(String error, String message, String path, List<FieldDetail> details) {
        return new ApiError(error, message, details, Instant.now(), path);
    }

    /**
     * Map common HTTP status codes to error token strings
     */
    public static String codeFor(int status) {
        return switch (status) {
            case 400 -> "BAD_REQUEST";
            case 401 -> "UNAUTHORIZED";
            case 403 -> "FORBIDDEN";
            case 404 -> "NOT_FOUND";
            case 405 -> "METHOD_NOT_ALLOWED";
            case 409 -> "CONFLICT";
            case 422 -> "UNPROCESSABLE";
            case 429 -> "TOO_MANY_REQUESTS";
            default -> "ERROR_" + status;
        };
    }

    public record FieldDetail(String field, String issue) {
    }
}
