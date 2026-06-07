package com.transact;

import com.transact.processor.model.AppUser;
import com.transact.processor.model.Country;
import com.transact.processor.model.Departments;
import com.transact.service.EmailService;
import com.transact.service.PasswordService;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

@Path("/api/users")
@RolesAllowed("ADMIN")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class UserResource {

    private static final Logger LOG = Logger.getLogger(UserResource.class);
    private static final Set<String> VALID_ROLES = Set.of("INPUTTER", "ADMIN", "AUTHORISER");

    @Inject
    SecurityIdentity identity;
    @Inject
    PasswordService passwordService;
    @Inject
    EmailService emailService;

    // ── GET /api/users/list ───────────────────────────────────────────────────

    @GET
    @Path("/list")
    public Response findAll() {
        String admin = identity.getPrincipal().getName();
        try {
            List<UserViewDTO> users = AppUser.<AppUser>listAll().stream()
                    .map(UserViewDTO::from)
                    .collect(Collectors.toList());
            LOG.debugf("Admin %s fetched user list (%d users)", admin, users.size());
            return Response.ok(users).build();
        } catch (Exception e) {
            LOG.errorf(e, "Failed to list users for admin %s", admin);
            return serverError("Failed to retrieve user list");
        }
    }

    // ── GET /api/users/exists ─────────────────────────────────────────────────

    /**
     * Real-time username availability check (debounced from the frontend).
     */
    @GET
    @Path("/exists")
    public Response exists(@QueryParam("username") String username) {
        if (username == null || username.isBlank()) return badRequest("Username is required");
        boolean taken = AppUser.findByUsername(username.trim().toUpperCase()).isPresent();
        return Response.ok(new ExistsResponse(taken)).build();
    }

    // ── POST /api/users ───────────────────────────────────────────────────────

    @POST
    public Response addUser(CreateUserRequest req) {
        String admin = identity.getPrincipal().getName();

        if (req == null) return badRequest("Request body is required");

        // Normalise
        String username = req.username() == null ? null : req.username().trim().toUpperCase();
        String role = req.role() == null ? null : req.role().trim().toUpperCase();
        String country = req.country() == null ? null : req.country().trim().toUpperCase();
        String email = req.email() == null ? null : req.email().trim().toLowerCase();

        // Validate required fields
        if (isBlank(username)) return badRequest("Username is required");
        if (isBlank(req.password())) return badRequest("Password is required");
        if (isBlank(role)) return badRequest("Role is required");
        if (isBlank(country)) return badRequest("Country is required");
        if (req.department() == null || req.department() <= 0) return badRequest("Department must be a positive number");

        if (!VALID_ROLES.contains(role)) {
            return badRequest("Invalid role '" + role + "'. Allowed: " + VALID_ROLES);
        }

        // Email mandatory for non-ADMIN users (required for MFA and password reset)
        boolean isAdminRole = "ADMIN".equals(role);
        if (!isAdminRole && isBlank(email)) {
            return badRequest("L\'adresse e-mail est obligatoire pour les rôles INPUTTER et AUTHORISER (nécessaire pour le MFA et la réinitialisation du mot de passe).");
        }
        // Validate email format if provided
        if (!isBlank(email) && !email.matches("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")) {
            return badRequest("Format d\'adresse e-mail invalide.");
        }

        // Validate password policy
        try {
            passwordService.validate(req.password());
        } catch (IllegalArgumentException e) {
            return badRequest(e.getMessage());
        }

        // Check username uniqueness (single authoritative check — removed from AppUser.add())
        if (AppUser.findByUsername(username).isPresent()) {
            return Response.status(409).entity(new ErrorResponse("USERNAME_TAKEN",
                    "Username '" + username + "' is already taken", Instant.now())).build();
        }

        // Validate country and department exist
        Country countryEntity = Country.find("code", country).firstResult();
        if (countryEntity == null) return badRequest("Country code not found: " + country);

        Departments deptEntity = Departments.find("code", req.department()).firstResult();
        if (deptEntity == null) return badRequest("Department code not found: " + req.department());

        try {
            AppUser user = new AppUser();
            user.setUsername(username);
            user.setPasswordHash(passwordService.hash(req.password()));
            user.setRole(AppUser.UserRole.valueOf(role));
            user.setCountryCode(countryEntity.code);
            user.setDepartment(deptEntity.code);
            user.email = email;
            user.mustChangePassword = true;      // Always force change on first login
            user.status = AppUser.UserStatus.ACTIVE;
            user.createdAt = Instant.now();
            user.createdBy = admin;
            user.persist();

            // Send welcome email if address provided
            if (!isBlank(email)) {
                emailService.sendWelcome(email, username, req.password());
            }

            LOG.infof("[Users] Created user %s (role: %s, country: %s) by admin %s", username, role, country, admin);

            return Response.status(201).entity(UserViewDTO.from(user)).build();

        } catch (Exception e) {
            LOG.errorf(e, "[Users] Failed to create user %s by admin %s", username, admin);
            return serverError("Failed to create user. Please contact support.");
        }
    }

    // ── DTOs ──────────────────────────────────────────────────────────────────

    public record CreateUserRequest(
            String username,
            String password,
            String role,
            String country,
            Integer department,
            String email
    ) {}

    private Response badRequest(String msg) {
        return Response.status(400).entity(new ErrorResponse("BAD_REQUEST", msg, Instant.now())).build();
    }

    public record ExistsResponse(boolean taken) {
    }

    public record ErrorResponse(String code, String message, Instant timestamp) {
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private Response serverError(String msg) {
        return Response.status(500).entity(new ErrorResponse("SERVER_ERROR", msg, Instant.now())).build();
    }

    private boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    public record UserViewDTO(
            String username,
            String countryCode,
            String role,
            Integer department,
            String email,
            String status,
            boolean mustChangePassword,
            int failedLoginCount,
            Instant createdAt,
            String createdBy,
            Instant lastLoginAt
    ) {
        static UserViewDTO from(AppUser u) {
            return new UserViewDTO(
                    u.getUsername(),
                    u.countryCode,
                    u.getRole().toString(),
                    u.getDepartment(),
                    u.email,
                    u.status != null ? u.status.name() : "ACTIVE",
                    u.mustChangePassword,
                    u.failedLoginCount,
                    u.createdAt,
                    u.createdBy,
                    u.lastLoginAt
            );
        }
    }
}
