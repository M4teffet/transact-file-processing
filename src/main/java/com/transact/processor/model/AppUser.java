package com.transact.processor.model;

import io.quarkus.mongodb.panache.PanacheMongoEntity;
import io.quarkus.mongodb.panache.common.MongoEntity;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.bson.types.ObjectId;
import org.mindrot.jbcrypt.BCrypt;

import java.util.Optional;

@MongoEntity(collection = "app_user")
public class AppUser extends PanacheMongoEntity {

    @NotBlank
    @Size(min = 3, max = 50)
    public String username;

    @NotBlank
    @Size(min = 8)
    public String passwordHash;

    private UserRole role = UserRole.INPUTTER;

    // Constructor for Panache
    public AppUser() {
    }

    public static AppUser add(@NotBlank String username, @NotBlank String password, @NotBlank String roleStr) {

        // Validate and parse role
        UserRole role;
        try {
            role = UserRole.valueOf(roleStr.toUpperCase()); // Enforce uppercase for consistency
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("Invalid role: " + roleStr + ". Must be INPUTTER, ADMIN, or AUTHORISER.");
        }

        // Check for existing user
        Optional<AppUser> existing = findByUsername(username);
        if (existing.isPresent()) {
            throw new IllegalArgumentException("Username already exists: " + username);
        }

        AppUser user = new AppUser();
        user.setUsername(username.trim());
        user.setPasswordHash(BCrypt.hashpw(password, BCrypt.gensalt()));
        user.setRole(role);

        user.persist();
        return user;
    }

    public static Optional<AppUser> findByUsername(@NotBlank String username) {
        return Optional.ofNullable(find("username", username).firstResult());
    }

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public String getPasswordHash() {
        return passwordHash;
    }

    public void setPasswordHash(String passwordHash) {
        this.passwordHash = passwordHash;
    }

    public UserRole getRole() {
        return role;
    }

    public void setRole(UserRole role) {
        this.role = role;
    }

    public ObjectId getId() {
        return id;
    }

    // Enum for roles (stored as string in MongoDB via Panache)
    public enum UserRole {
        INPUTTER, ADMIN, AUTHORISER
    }
}