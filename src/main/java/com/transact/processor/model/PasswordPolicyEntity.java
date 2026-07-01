package com.transact.processor.model;

import io.quarkus.mongodb.panache.PanacheMongoEntity;
import io.quarkus.mongodb.panache.common.MongoEntity;

/**
 * Singleton MongoDB document that persists the password policy across restarts.
 * <p>
 * Why not application.properties?
 *
 * @ConfigProperty values are injected once at startup and never change.
 * Writing to the .properties file at runtime only takes effect after a restart,
 * and in containerised deployments the file is inside the read-only JAR anyway.
 * <p>
 * The policy is stored as a single document in the "password_policy" collection.
 * If no document exists (first boot), callers fall back to hardcoded defaults and
 * the Initializer creates the document on startup.
 */
@MongoEntity(collection = "password_policy")
public class PasswordPolicyEntity extends PanacheMongoEntity {

    /**
     * Minimum password length (chars). Default: 10.
     */
    public int minLength = 10;

    /**
     * Require at least one digit. Default: true.
     */
    public boolean requireDigit = true;

    /**
     * Require at least one uppercase letter. Default: true.
     */
    public boolean requireUppercase = true;

    /**
     * Require at least one special character. Default: true.
     */
    public boolean requireSpecial = true;

    // ── Queries ───────────────────────────────────────────────────────────────

    /**
     * Returns the stored policy, or {@code null} if the collection is empty.
     */
    public static PasswordPolicyEntity load() {
        return findAll().firstResult();
    }

    /**
     * Returns the stored policy, or a default instance if nothing is in the DB yet.
     * Never returns {@code null}.
     */
    public static PasswordPolicyEntity loadOrDefault() {
        PasswordPolicyEntity p = load();
        if (p != null) return p;
        var d = new PasswordPolicyEntity();   // fields already hold defaults
        return d;
    }

    // ── Upsert ────────────────────────────────────────────────────────────────

    /**
     * Persists {@code this} — inserts if no document exists, updates the
     * existing one otherwise.
     */
    public void save() {
        PasswordPolicyEntity existing = load();
        if (existing == null) {
            persist();
        } else {
            existing.minLength = this.minLength;
            existing.requireDigit = this.requireDigit;
            existing.requireUppercase = this.requireUppercase;
            existing.requireSpecial = this.requireSpecial;
            existing.update();
        }
    }
}
