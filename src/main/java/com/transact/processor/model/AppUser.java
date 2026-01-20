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

    @NotBlank
    public String countryCode;

    @NotBlank
    public UserRole role = UserRole.INPUTTER;

    @NotBlank
    public Integer department;


    public AppUser() {
    }

    public static AppUser add(String username, String password, String roleStr, String countryName, Integer department) {

        // Validate and parse role
        UserRole role;
        try {
            role = UserRole.valueOf(roleStr.toUpperCase()); // Enforce uppercase for consistency
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("Invalid role: " + roleStr + ". Must be INPUTTER, ADMIN, or AUTHORISER.");
        }

        Country country = Country.find("code", countryName).firstResult();

        if (country == null) {
            throw new IllegalArgumentException("Invalid country code: " + countryName);
        }

        Departments departments = Departments.find("code", department).firstResult();

        System.out.println("Department code: " + departments.code);

        if (departments == null) {
            throw new IllegalArgumentException("Invalid department code: " + department);
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
        user.setCountryCode(country.code);

        user.persist();
        return user;
    }

    public static Optional<AppUser> findByUsername(String username) {
        return Optional.ofNullable(find("username", username).firstResult());
    }

    public void setCountryCode(String countryCode) {
        this.countryCode = countryCode;
    }

    public String getCountryCode() {
        return countryCode;
    }

    public Integer getDepartment() {
        return department;
    }

    public void setDepartment(Integer department) {
        this.department = department;
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

    public enum UserRole {
        INPUTTER,
        ADMIN,
        AUTHORISER
    }
}