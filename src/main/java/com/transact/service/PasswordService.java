package com.transact.service;

import com.transact.processor.model.PasswordPolicyEntity;
import jakarta.enterprise.context.ApplicationScoped;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.mindrot.jbcrypt.BCrypt;

import java.security.SecureRandom;

/**
 * Centralised password hashing and policy enforcement.
 *
 * Policy (minLength, requireDigit, etc.) is loaded from MongoDB at call time
 * via PasswordPolicyEntity.loadOrDefault(). This means:
 *   - Admin changes take effect immediately on the next password operation.
 *   - No server restart is needed.
 *   - Works correctly in Docker/JAR — no filesystem writes required.
 *
 * bcryptRounds is kept in application.properties (rarely changed, requires
 * a restart anyway to recompute existing hashes consistently).
 */
@ApplicationScoped
public class PasswordService {

    private static final String SPECIAL_CHARS = "!@#$%^&*()_+-=[]{}|;':\",./<>?";

    @ConfigProperty(name = "app.admin.bcrypt-rounds", defaultValue = "12")
    int bcryptRounds;

    // ── Policy helpers ────────────────────────────────────────────────────────

    /**
     * Returns a live snapshot of the policy from MongoDB. Never null.
     */
    public PasswordPolicy getPolicy() {
        PasswordPolicyEntity p = PasswordPolicyEntity.loadOrDefault();
        return new PasswordPolicy(p.minLength, p.requireDigit, p.requireUppercase, p.requireSpecial);
    }

    // ── Hash / verify ─────────────────────────────────────────────────────────

    /**
     * Hash a plain-text password — enforces the current policy.
     * Use for all user-facing password operations.
     */
    public String hash(String plainPassword) {
        validate(plainPassword);
        return BCrypt.hashpw(plainPassword, BCrypt.gensalt(bcryptRounds));
    }

    /**
     * Hash without policy validation — for internal/system use only
     * (e.g. seeding the initial admin with a known temporary password).
     */
    public String hashRaw(String plainPassword) {
        if (plainPassword == null || plainPassword.isEmpty())
            throw new IllegalArgumentException("Password must not be blank");
        return BCrypt.hashpw(plainPassword, BCrypt.gensalt(bcryptRounds));
    }

    /** Verify a plain-text password against a stored BCrypt hash. */
    public boolean verify(String plainPassword, String hash) {
        if (plainPassword == null || hash == null) return false;
        try {
            return BCrypt.checkpw(plainPassword, hash);
        } catch (Exception e) {
            return false;
        }
    }

    // ── Validation ────────────────────────────────────────────────────────────

    /**
     * Validate a password against the current MongoDB policy.
     * Throws {@link IllegalArgumentException} with a human-readable message if invalid.
     * Called by hash() and any endpoint that accepts a new password.
     */
    public void validate(String password) {
        PasswordPolicyEntity p = PasswordPolicyEntity.loadOrDefault();

        if (password == null || password.length() < p.minLength)
            throw new IllegalArgumentException(
                    "Le mot de passe doit contenir au moins " + p.minLength + " caractères.");

        if (password.contains(" "))
            throw new IllegalArgumentException("Le mot de passe ne doit pas contenir d'espaces.");

        if (p.requireDigit && !password.chars().anyMatch(Character::isDigit))
            throw new IllegalArgumentException("Le mot de passe doit contenir au moins un chiffre.");

        if (p.requireUppercase && !password.chars().anyMatch(Character::isUpperCase))
            throw new IllegalArgumentException("Le mot de passe doit contenir au moins une majuscule.");

        if (p.requireSpecial && SPECIAL_CHARS.chars().noneMatch(sc -> password.indexOf(sc) >= 0))
            throw new IllegalArgumentException(
                    "Le mot de passe doit contenir au moins un caractère spécial (!@#$%^&* etc.).");
    }

    // ── Temporary password generator ──────────────────────────────────────────

    /**
     * Generate a cryptographically random temporary password that satisfies the
     * current policy. Sent to new users by email; they must change it on first login.
     */
    public String generateTemporary() {
        PasswordPolicyEntity p = PasswordPolicyEntity.loadOrDefault();
        SecureRandom rng = new SecureRandom();
        String upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        String lower = "abcdefghijklmnopqrstuvwxyz";
        String digits = "0123456789";
        String special = "!@#$%^&*()_+-=";
        String all = upper + lower + digits + special;

        StringBuilder sb = new StringBuilder();
        // Guarantee at least one of each required type
        sb.append(upper.charAt(rng.nextInt(upper.length())));
        if (p.requireDigit) sb.append(digits.charAt(rng.nextInt(digits.length())));
        if (p.requireSpecial) sb.append(special.charAt(rng.nextInt(special.length())));
        if (p.requireUppercase) sb.append(upper.charAt(rng.nextInt(upper.length())));

        // Fill to policy minLength, at least 12 for safety
        int target = Math.max(p.minLength, 12);
        while (sb.length() < target)
            sb.append(all.charAt(rng.nextInt(all.length())));

        // Shuffle to avoid predictable prefix pattern
        char[] chars = sb.toString().toCharArray();
        for (int i = chars.length - 1; i > 0; i--) {
            int j = rng.nextInt(i + 1);
            char tmp = chars[i];
            chars[i] = chars[j];
            chars[j] = tmp;
        }
        return new String(chars);
    }

    // ── DTO ───────────────────────────────────────────────────────────────────

    public record PasswordPolicy(
            int minLength,
            boolean requireDigit,
            boolean requireUppercase,
            boolean requireSpecial
    ) {}
}
