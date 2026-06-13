package com.transact;

import com.transact.processor.model.AdminAuditLog;
import com.transact.processor.model.AppUser;
import com.transact.processor.model.OtpToken;
import com.transact.service.EmailService;
import com.transact.service.PasswordService;
import io.quarkus.security.Authenticated;
import io.quarkus.security.identity.SecurityIdentity;
import io.smallrye.jwt.build.Jwt;
import jakarta.annotation.security.PermitAll;
import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.jwt.JsonWebToken;
import org.jboss.logging.Logger;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;

/**
 * AuthResource - handles all post-login security flows:
 *
 *  POST /api/auth/change-password   — first-login forced change (authenticated)
 *  POST /api/auth/forgot-password   — request reset link via email
 *  POST /api/auth/reset-password    — submit new password with reset token
 *  POST /api/auth/verify-otp        — verify OTP code after password, complete login
 *  POST /api/auth/resend-otp        — resend OTP code to email
 *  GET  /api/auth/password-policy   — return policy rules for frontend strength meter
 */
@Path("/api/auth")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class AuthResource {

    private static final Logger LOG = Logger.getLogger(AuthResource.class);

    @Inject
    PasswordService passwordService;
    @Inject
    EmailService emailService;
    @Inject
    SecurityIdentity identity;
    @Inject
    JsonWebToken jwt;

    @ConfigProperty(name = "mp.jwt.expire-seconds", defaultValue = "3600")
    long tokenExpirySeconds;

    @ConfigProperty(name = "app.otp.expiry-seconds", defaultValue = "300")
    int otpExpirySeconds;

    @ConfigProperty(name = "app.reset.expiry-seconds", defaultValue = "1800")
    int resetExpirySeconds;

    @ConfigProperty(name = "app.login.max-failed-attempts", defaultValue = "5")
    int maxFailedAttempts;

    // ── GET /api/auth/password-policy ─────────────────────────────────────────

    @GET
    @Path("/password-policy")
    @PermitAll
    public Response getPolicy() {
        return Response.ok(passwordService.getPolicy()).build();
    }

    // ── POST /api/auth/change-password ────────────────────────────────────────

    @POST
    @Path("/change-password")
    @Authenticated
    public Response changePassword(ChangePasswordRequest req) {
        String username = identity.getPrincipal().getName();
        AppUser user = AppUser.findByUsername(username).orElse(null);

        if (user == null) return notFound("User not found");

        // Verify current password
        if (!passwordService.verify(req.currentPassword(), user.getPasswordHash())) {
            LOG.warnf("[Auth] Change-password: wrong current password for %s", username);
            return badRequest("Current password is incorrect");
        }

        // Prevent reuse of current password
        if (passwordService.verify(req.newPassword(), user.getPasswordHash())) {
            return badRequest("New password must be different from the current password");
        }

        try {
            String newHash = passwordService.hash(req.newPassword());
            user.passwordHash = newHash;
            user.passwordVersion = user.passwordVersion + 1;   // invalidates all existing sessions
            user.mustChangePassword = false;
            user.status = AppUser.UserStatus.ACTIVE;
            user.updatedAt = Instant.now();
            user.updatedBy = username;
            user.update();
            LOG.infof("[Auth] Password changed for %s — session version now %d", username, user.passwordVersion);
            return Response.ok(Map.of("message", "Password changed successfully")).build();
        } catch (IllegalArgumentException e) {
            return badRequest(e.getMessage());
        }
    }

    // ── POST /api/auth/forgot-password ────────────────────────────────────────

    @POST
    @Path("/forgot-password")
    @PermitAll
    public Response forgotPassword(ForgotPasswordRequest req) {
        // Always return 200 to avoid user enumeration attacks
        if (req.email() == null || req.email().isBlank()) {
            return Response.ok(Map.of("message", "If that address is registered, you will receive an email")).build();
        }

        AppUser user = AppUser.findByEmail(req.email().trim().toLowerCase()).orElse(null);

        if (user != null && user.email != null) {
            String token = OtpToken.createResetToken(user.username, resetExpirySeconds);
            emailService.sendPasswordReset(user.email, user.username, token);
            LOG.infof("[Auth] Password reset requested for %s", user.username);
        }

        return Response.ok(Map.of("message", "If that address is registered, you will receive an email")).build();
    }

    // ── POST /api/auth/reset-password ────────────────────────────────────────

    @POST
    @Path("/reset-password")
    @PermitAll
    public Response resetPassword(ResetPasswordRequest req) {
        if (req.token() == null || req.token().isBlank()) return badRequest("Token is required");

        Optional<OtpToken> tokenOpt = OtpToken.findValidByToken(req.token(), OtpToken.Purpose.PASSWORD_RESET);
        if (tokenOpt.isEmpty()) {
            LOG.warnf("[Auth] Invalid or expired reset token used");
            return badRequest("This reset link is invalid or has expired");
        }

        OtpToken otpToken = tokenOpt.get();
        AppUser user = AppUser.findByUsername(otpToken.username).orElse(null);
        if (user == null) return notFound("User not found");

        try {
            String newHash = passwordService.hash(req.newPassword());
            user.passwordHash = newHash;
            user.passwordVersion = user.passwordVersion + 1;
            user.mustChangePassword = false;
            user.failedLoginCount = 0;
            user.status = AppUser.UserStatus.ACTIVE;
            user.updatedAt = Instant.now();
            user.update();

            otpToken.consume();

            LOG.infof("[Auth] Password reset completed for %s", user.username);
            return Response.ok(Map.of("message", "Password has been reset successfully. You may now log in.")).build();
        } catch (IllegalArgumentException e) {
            return badRequest(e.getMessage());
        }
    }

    // ── POST /api/auth/verify-otp ────────────────────────────────────────────

    /**
     * Step 2 of login: user submits the OTP code they received by email.
     * If valid, issues the full JWT and sets the auth cookie.
     */
    @POST
    @Path("/verify-otp")
    @PermitAll
    public Response verifyOtp(VerifyOtpRequest req) {
        if (req.username() == null || req.otp() == null) return badRequest("Username and OTP are required");

        AppUser user = AppUser.findByUsername(req.username().trim().toUpperCase()).orElse(null);
        if (user == null) return unauthorized("Invalid credentials");

        if (user.isLocked()) return unauthorized("Account is locked. Contact your administrator.");

        String submittedOtp = req.otp().trim().replaceAll("\\s+", "");
        LOG.infof("[Auth] OTP verify — user: %s, submitted: '%s'", user.username, submittedOtp);

        // Diagnostic: log all OTP tokens for this user in DB
        OtpToken.<OtpToken>find("username = ?1 and purpose = ?2", user.username, "OTP_LOGIN")
                .stream().forEach(t -> LOG.infof("[Auth] DB token — token: '%s', used: %s, expires: %s, now: %s",
                        t.token, t.used, t.expiresAt, java.time.Instant.now()));

        Optional<OtpToken> tokenOpt = OtpToken.findValid(user.username, submittedOtp, OtpToken.Purpose.OTP_LOGIN);

        if (tokenOpt.isEmpty()) {
            user.recordFailedLogin(maxFailedAttempts);
            LOG.warnf("[Auth] OTP not found for %s (attempt %d) — submitted: '%s'",
                    user.username, user.failedLoginCount, submittedOtp);
            return unauthorized("Invalid or expired code");
        }

        tokenOpt.get().consume();
        user.recordSuccessfulLogin();

        String token = Jwt.issuer("orange-bank-app")
                .upn(user.getUsername())
                .groups(user.getRole().name())
                .claim("pwv", user.passwordVersion)
                .expiresAt(Instant.now().plusSeconds(tokenExpirySeconds))
                .sign();

        jakarta.ws.rs.core.NewCookie authCookie = new jakarta.ws.rs.core.NewCookie.Builder("AuthToken")
                .value(token)
                .path("/")
                .maxAge((int) tokenExpirySeconds)
                .secure(false)   // true in production (HTTPS)
                .httpOnly(true)
                .sameSite(jakarta.ws.rs.core.NewCookie.SameSite.STRICT)
                .build();

        LOG.infof("[Auth] OTP verified — JWT issued for %s", user.username);

        return Response.ok(Map.of(
                "username", user.getUsername(),
                "role", user.getRole().name(),
                "country", user.getCountryCode(),
                "mustChangePassword", user.mustChangePassword,
                "message", "Authentication successful"
        )).cookie(authCookie).build();
    }

    // ── POST /api/auth/resend-otp ────────────────────────────────────────────

    @POST
    @Path("/resend-otp")
    @PermitAll
    public Response resendOtp(ResendOtpRequest req) {
        if (req.username() == null) return badRequest("Username is required");

        AppUser user = AppUser.findByUsername(req.username().trim().toUpperCase()).orElse(null);
        // Always return 200 to avoid enumeration
        if (user != null && user.email != null && !user.isLocked()) {
            String otp = OtpToken.createOtp(user.username, otpExpirySeconds);
            emailService.sendOtp(user.email, user.username, otp);
            LOG.infof("[Auth] OTP resent for %s", user.username);
        }
        return Response.ok(Map.of("message", "If your account has a registered email, a new code has been sent")).build();
    }

    // ── POST /api/auth/unlock/:username ──────────────────────────────────────

    @POST
    @Path("/unlock/{username}")
    @RolesAllowed("ADMIN")
    public Response unlockUser(@PathParam("username") String username) {
        AppUser user = AppUser.findByUsername(username.trim().toUpperCase()).orElse(null);
        if (user == null) return notFound("User not found: " + username);

        user.status = AppUser.UserStatus.ACTIVE;
        user.failedLoginCount = 0;
        user.update();

        AdminAuditLog.record(identity.getPrincipal().getName(),
                AdminAuditLog.USER_UNLOCKED, username,
                "Compte déverrouillé par l'administrateur");
        LOG.infof("[Auth] Account unlocked: %s by %s", username, identity.getPrincipal().getName());
        return Response.ok(Map.of("message", "Compte déverrouillé avec succès", "username", username)).build();
    }

    // ── POST /api/auth/lock/:username ─────────────────────────────────────────

    @POST
    @Path("/lock/{username}")
    @RolesAllowed("ADMIN")
    public Response lockUser(@PathParam("username") String username) {
        String admin = identity.getPrincipal().getName();
        AppUser user = AppUser.findByUsername(username.trim().toUpperCase()).orElse(null);
        if (user == null) return notFound("User not found: " + username);

        // Prevent admin from locking themselves
        if (user.getUsername().equalsIgnoreCase(admin)) {
            return Response.status(400)
                    .entity(Map.of("message", "Vous ne pouvez pas verrouiller votre propre compte."))
                    .build();
        }

        user.status = AppUser.UserStatus.LOCKED;
        user.update();

        AdminAuditLog.record(admin, AdminAuditLog.USER_LOCKED, username,
                "Compte verrouillé manuellement par l'administrateur");
        LOG.infof("[Auth] Account locked: %s by %s", username, admin);
        return Response.ok(Map.of("message", "Compte verrouillé avec succès", "username", username)).build();
    }

    // ── Request records ───────────────────────────────────────────────────────

    public record ChangePasswordRequest(String currentPassword, String newPassword) {
    }

    public record ForgotPasswordRequest(String email) {
    }

    public record ResetPasswordRequest(String token, String newPassword) {
    }

    public record VerifyOtpRequest(String username, String otp) {
    }

    public record ResendOtpRequest(String username) {
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private Response badRequest(String msg) {
        return Response.status(400).entity(Map.of("message", msg)).build();
    }

    private Response notFound(String msg) {
        return Response.status(404).entity(Map.of("message", msg)).build();
    }

    private Response unauthorized(String msg) {
        return Response.status(401).entity(Map.of("message", msg)).build();
    }
}
