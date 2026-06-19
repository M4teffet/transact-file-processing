package com.transact.processor.model;

import io.quarkus.mongodb.panache.PanacheMongoEntity;
import io.quarkus.mongodb.panache.common.MongoEntity;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.Optional;

@MongoEntity(collection = "otp_token")
public class OtpToken extends PanacheMongoEntity {

    private static final SecureRandom RANDOM = new SecureRandom();
    public String username;
    public String token;
    public String purpose;      // stored as String — avoids BSON enum codec issues
    public Instant expiresAt;
    public boolean used = false;
    public Instant createdAt = Instant.now();

    public static String createOtp(String username, int expirySeconds) {
        invalidateExisting(username, Purpose.OTP_LOGIN);
        String plain = String.format("%06d", 100_000 + RANDOM.nextInt(900_000));
        persist(username, plain, Purpose.OTP_LOGIN, expirySeconds);
        return plain;
    }

    // ── Factories ─────────────────────────────────────────────────────────────

    public static String createResetToken(String username, int expirySeconds) {
        invalidateExisting(username, Purpose.PASSWORD_RESET);
        String plain = generateUrlSafeToken();
        persist(username, plain, Purpose.PASSWORD_RESET, expirySeconds);
        return plain;
    }

    public static String createMagicLink(String username, int expirySeconds) {
        invalidateExisting(username, Purpose.MAGIC_LINK);
        String plain = generateUrlSafeToken();
        persist(username, plain, Purpose.MAGIC_LINK, expirySeconds);
        return plain;
    }

    public static Optional<OtpToken> findValid(String username, String plain, Purpose purpose) {
        // Expiry enforced in query — avoids fetching all tokens then filtering in memory
        return OtpToken.<OtpToken>find(
                "username = ?1 and token = ?2 and purpose = ?3 and used = ?4 and expiresAt > ?5",
                username, plain, purpose.name(), false, Instant.now()
        ).firstResultOptional();
    }

    public static Optional<OtpToken> findValidByToken(String plain, Purpose purpose) {
        return OtpToken.<OtpToken>find(
                "token = ?1 and purpose = ?2 and used = ?3 and expiresAt > ?4",
                plain, purpose.name(), false, Instant.now()
        ).firstResultOptional();
    }

    public static void ensureIndexes(@jakarta.enterprise.event.Observes io.quarkus.runtime.StartupEvent ev) {
        // TTL index — MongoDB auto-deletes expired tokens (backup to scheduled purge)
        mongoCollection().createIndex(
                com.mongodb.client.model.Indexes.ascending("expiresAt"),
                new com.mongodb.client.model.IndexOptions()
                        .expireAfter(0L, java.util.concurrent.TimeUnit.SECONDS)
                        .background(true)
        );
        // Compound index for fast OTP lookups
        mongoCollection().createIndex(
                com.mongodb.client.model.Indexes.ascending("username", "purpose", "used"),
                new com.mongodb.client.model.IndexOptions().background(true)
        );
    }

    private static void invalidateExisting(String username, Purpose purpose) {
        OtpToken.update("used", true)
                .where("username = ?1 and purpose = ?2 and used = ?3",
                        username, purpose.name(), false);
    }

    private static void persist(String username, String plain, Purpose purpose, int expirySeconds) {
        OtpToken t = new OtpToken();
        t.username = username;
        t.token = plain;
        t.purpose = purpose.name();
        t.expiresAt = Instant.now().plusSeconds(expirySeconds);
        t.persist();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static String generateUrlSafeToken() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    public static long purgeExpired() {
        return OtpToken.delete("expiresAt < ?1", Instant.now());
    }

    public void consume() {
        this.used = true;
        this.update();
    }

    public enum Purpose {OTP_LOGIN, PASSWORD_RESET, MAGIC_LINK}
}