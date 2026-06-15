package com.transact.processor.model;

import com.mongodb.client.model.IndexOptions;
import com.mongodb.client.model.Indexes;
import io.quarkus.mongodb.panache.PanacheMongoEntity;
import io.quarkus.mongodb.panache.common.MongoEntity;
import io.quarkus.runtime.StartupEvent;
import jakarta.enterprise.event.Observes;

import java.time.Instant;
import java.util.Map;

/**
 * Immutable audit trail for all admin actions that affect users, configuration,
 * or operating windows. Kept separate from processing_logs (which have a TTL
 * and are operational) — audit logs must be retained long-term.
 *
 * Collection: admin_audit_log
 */
@MongoEntity(collection = "admin_audit_log")
public class AdminAuditLog extends PanacheMongoEntity {

    /**
     * The admin who performed the action
     */
    public String performedBy;

    // ── Action constants ──────────────────────────────────────────────────────
    public static final String USER_CREATED = "USER_CREATED";
    public static final String USER_LOCKED = "USER_LOCKED";
    public static final String USER_UNLOCKED = "USER_UNLOCKED";
    public static final String USER_ROLE_CHANGED = "USER_ROLE_CHANGED";

    public Instant timestamp = Instant.now();

    public AdminAuditLog() {
    }

    // ── Factory ───────────────────────────────────────────────────────────────

    public static void record(String performedBy, String action, String target,
                              String description, Map<String, Object> metadata) {
        AdminAuditLog entry = new AdminAuditLog();
        entry.performedBy = performedBy;
        entry.action = action;
        entry.target = target;
        entry.description = description;
        entry.metadata = metadata;
        entry.timestamp = Instant.now();
        entry.persist();
    }

    public static void record(String performedBy, String action, String target, String description) {
        record(performedBy, action, target, description, null);
    }

    // ── Indexes ───────────────────────────────────────────────────────────────

    public static void ensureIndexes(@Observes StartupEvent ev) {
        // Query by performer, target, or action — all common access patterns
        mongoCollection().createIndex(Indexes.ascending("performedBy"),
                new IndexOptions().background(true));
        mongoCollection().createIndex(Indexes.ascending("target"),
                new IndexOptions().background(true));
        mongoCollection().createIndex(Indexes.ascending("action"),
                new IndexOptions().background(true));
        mongoCollection().createIndex(Indexes.descending("timestamp"),
                new IndexOptions().background(true));
    }
    public static final String PASSWORD_RESET_ADMIN = "PASSWORD_RESET_BY_ADMIN";
    public static final String WINDOW_UPDATED = "OPERATING_WINDOW_UPDATED";
    public static final String BATCH_DELETED = "BATCH_DELETED";
    public static final String BATCH_VALIDATED = "BATCH_VALIDATED";
    /** Structured action type: USER_CREATED, USER_LOCKED, PASSWORD_CHANGED, etc. */
    public String action;
    /** Primary subject of the action (username, batchId, etc.) */
    public String target;
    /** Human-readable summary */
    public String description;
    /** Snapshot of relevant before/after values — never store passwords or hashes */
    public Map<String, Object> metadata;
}
