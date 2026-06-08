package com.transact;

import jakarta.enterprise.context.ApplicationScoped;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.mindrot.jbcrypt.BCrypt;

/**
 * Centralised password hashing and policy enforcement.
 * Single source of truth for all password operations in the app.
 */
@ApplicationScoped
public class PasswordService {

    private static final String SPECIAL_CHARS = "!@#$%^&*()_+-=[]{}|;':\",./<>?";
    @ConfigProperty(name = "app.admin.bcrypt-rounds", defaultValue = "12")
    int bcryptRounds;
    @ConfigProperty(name = "app.password.min-length", defaultValue = "8")
    int minLength;
    @ConfigProperty(name = "app.password.require-digit", defaultValue = "true")
    boolean requireDigit;
    @ConfigProperty(name = "app.password.require-uppercase", defaultValue = "true")
    boolean requireUppercase;
    @ConfigProperty(name = "app.password.require-special", defaultValue = "true")
    boolean requireSpecial;

    /**
     * Hash a plain-text password — enforces policy. Use for all user-facing operations.
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
        if (plainPassword == null || plainPassword.isEmpty()) {
            throw new IllegalArgumentException("Password must not be blank");
        }
        return BCrypt.hashpw(plainPassword, BCrypt.gensalt(bcryptRounds));
    }

    /**
     * Verify a plain-text password against a stored hash.
     */
    public boolean verify(String plainPassword, String hash) {
        if (plainPassword == null || hash == null) return false;
        try {
            return BCrypt.checkpw(plainPassword, hash);
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Validate password against the configured policy.
     * Throws IllegalArgumentException with a human-readable message if invalid.
     */
    public void validate(String password) {
        if (password == null || password.length() < minLength) {
            throw new IllegalArgumentException(
                    "Password must be at least " + minLength + " characters long.");
        }
        if (password.contains(" ")) {
            throw new IllegalArgumentException("Password must not contain spaces.");
        }
        if (requireDigit && !password.chars().anyMatch(Character::isDigit)) {
            throw new IllegalArgumentException("Password must contain at least one digit.");
        }
        if (requireUppercase && !password.chars().anyMatch(Character::isUpperCase)) {
            throw new IllegalArgumentException("Password must contain at least one uppercase letter.");
        }
        if (requireSpecial && SPECIAL_CHARS.chars().noneMatch(sc -> password.indexOf(sc) >= 0)) {
            throw new IllegalArgumentException(
                    "Password must contain at least one special character (!@#$%^&* etc.).");
        }
    }

    /**
     * Returns a JSON-serialisable policy descriptor for the frontend strength meter.
     */
    public PasswordPolicy getPolicy() {
        return new PasswordPolicy(minLength, requireDigit, requireUppercase, requireSpecial);
    }

    public record PasswordPolicy(int minLength, boolean requireDigit,
                                 boolean requireUppercase, boolean requireSpecial) {
    }
}
