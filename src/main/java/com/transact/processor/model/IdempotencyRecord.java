package com.transact.processor.model;

import io.quarkus.mongodb.panache.PanacheMongoEntity;
import io.quarkus.mongodb.panache.common.MongoEntity;
import org.bson.codecs.pojo.annotations.BsonProperty;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

/**
 * Stores an Idempotency-Key for 24 hours so that duplicate requests
 * (e.g. double-click on Valider or upload retry) return the same response
 * as the original rather than creating a second batch or a second validation.
 * <p>
 * MongoDB TTL index must exist on the expireAt field:
 * db.idempotency_keys.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 })
 * <p>
 * This is created automatically by the Initializer on first boot.
 */
@MongoEntity(collection = "idempotency_keys")
public class IdempotencyRecord extends PanacheMongoEntity {

    public static final long TTL_HOURS = 24;
    /**
     * The client-supplied Idempotency-Key header value
     */
    public String key;
    /**
     * HTTP status code to replay
     */
    public int statusCode;
    /**
     * JSON body to replay (serialised string)
     */
    public String responseBody;
    /**
     * When this record was first stored
     */
    public Instant createdAt;
    /**
     * MongoDB TTL field — the record is automatically deleted when
     * the current server time passes this instant.
     * The @BsonProperty name must match the indexed field name exactly.
     */
    @BsonProperty("expireAt")
    public Instant expireAt;

    // ── Factory ───────────────────────────────────────────────────────────────

    public static IdempotencyRecord create(String key, int statusCode, String responseBody) {
        var r = new IdempotencyRecord();
        r.key = key;
        r.statusCode = statusCode;
        r.responseBody = responseBody;
        r.createdAt = Instant.now();
        r.expireAt = Instant.now().plus(TTL_HOURS, ChronoUnit.HOURS);
        return r;
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    public static IdempotencyRecord findByKey(String key) {
        return find("key", key).firstResult();
    }
}
