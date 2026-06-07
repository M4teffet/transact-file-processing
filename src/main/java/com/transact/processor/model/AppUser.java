package com.transact.processor.model;

import io.quarkus.mongodb.panache.PanacheMongoEntity;
import io.quarkus.mongodb.panache.common.MongoEntity;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.bson.types.ObjectId;

import java.time.Instant;
import java.util.Optional;

@MongoEntity(collection = "app_user")
public class AppUser extends PanacheMongoEntity {

    // ── Core fields ───────────────────────────────────────────────────────────
    @NotBlank
    @Size(min = 3, max = 50)
    public String username;
    /**
     * Email address — required for OTP/reset flows
     */
    public String email;
    /**
     * Forces a password change on the user's next successful login
     */
    public boolean mustChangePassword = false;

    @NotBlank
    @Size(min = 8)
    public String passwordHash;

    @NotBlank
    public String countryCode;

    @NotBlank
    public UserRole role = UserRole.INPUTTER;

    public Integer department;
    /**
     * Account lifecycle state
     */
    public UserStatus status = UserStatus.PENDING;

    // ── Security state ────────────────────────────────────────────────────────
    /**
     * Incremented on every failed login attempt; reset on success
     */
    public int failedLoginCount = 0;
    /** Timestamp of last successful login */
    public Instant lastLoginAt;
    // ── Audit fields ──────────────────────────────────────────────────────────
    public Instant createdAt = Instant.now();
    /** Username of the admin who created this account */
    public String createdBy;
    public Instant updatedAt;
    public String updatedBy;

    public static Optional<AppUser> findByUsername(String username) {
        if (username == null) return Optional.empty();
        return Optional.ofNullable(find("username", username).firstResult());
    }

    public static Optional<AppUser> findByEmail(String email) {
        if (email == null) return Optional.empty();
        return Optional.ofNullable(find("email", email).firstResult());
    }

    public AppUser() {
    }

    // ── Static finders ────────────────────────────────────────────────────────

    public void recordFailedLogin(int maxAttempts) {
        this.failedLoginCount++;
        if (this.failedLoginCount >= maxAttempts) {
            this.status = UserStatus.LOCKED;
        }
        this.update();
    }

    public void recordSuccessfulLogin() {
        this.failedLoginCount = 0;
        this.lastLoginAt = Instant.now();
        this.status = UserStatus.ACTIVE;
        this.update();
    }

    // ── Security helpers ─────────────────────────────────────────────────────

    public boolean isLocked() {
        return UserStatus.LOCKED.equals(this.status);
    }

    public boolean isActive() {
        return UserStatus.ACTIVE.equals(this.status);
    }

    public void setUsername(String u) {
        this.username = u;
    }

    public void setPasswordHash(String h) {
        this.passwordHash = h;
    }

    // ── Accessors ─────────────────────────────────────────────────────────────

    public String getUsername() {
        return username;
    }

    public void setRole(UserRole r) {
        this.role = r;
    }

    public String getPasswordHash() {
        return passwordHash;
    }

    public String getCountryCode() {
        return countryCode;
    }

    public UserRole getRole() {
        return role;
    }

    public void setCountryCode(String c) {
        this.countryCode = c;
    }

    public Integer getDepartment() {
        return department;
    }

    public void setDepartment(Integer d) {
        this.department = d; }

    public ObjectId getId() { return id; }

    // ── Status ────────────────────────────────────────────────────────────────
    public enum UserStatus {PENDING, ACTIVE, LOCKED}

    public enum UserRole {INPUTTER, ADMIN, AUTHORISER}
}
