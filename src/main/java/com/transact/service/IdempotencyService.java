package com.transact.service;

import com.transact.processor.model.IdempotencyRecord;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

/**
 * Checks and stores Idempotency-Key headers.
 * <p>
 * Usage pattern in a resource method:
 * <p>
 * String key = request.getHeaderString("Idempotency-Key");
 * Response cached = idempotency.checkAndReturn(key);
 * if (cached != null) return cached;
 * <p>
 * // ... do the real work ...
 * String body = objectMapper.writeValueAsString(result);
 * idempotency.store(key, 201, body);
 * return Response.status(201).entity(result).build();
 */
@ApplicationScoped
public class IdempotencyService {

    /**
     * Returns a replayed response if the key was already used; null otherwise.
     * A null/blank key is silently ignored (idempotency is optional for clients).
     */
    public Response checkAndReturn(String key) {
        if (key == null || key.isBlank()) return null;
        IdempotencyRecord record = IdempotencyRecord.findByKey(key);
        if (record == null) return null;

        return Response.status(record.statusCode)
                .type(MediaType.APPLICATION_JSON)
                .header("Idempotency-Replayed", "true")
                .entity(record.responseBody)
                .build();
    }

    /**
     * Stores a key after the request has been processed successfully.
     * Only stores 2xx responses — errors should not be cached.
     */
    public void store(String key, int statusCode, String responseBody) {
        if (key == null || key.isBlank()) return;
        if (statusCode < 200 || statusCode >= 300) return;
        try {
            IdempotencyRecord.findByKey(key); // no-op if already exists (race)
            IdempotencyRecord.create(key, statusCode, responseBody).persist();
        } catch (Exception ignored) {
            // Duplicate key insert on a race — safe to ignore, first writer wins
        }
    }
}
