package com.transact;

import com.transact.processor.model.AppUser;
import com.transact.processor.model.OtpToken;
import com.transact.service.EmailService;
import com.transact.service.PasswordService;
import jakarta.inject.Inject;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.*;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.resteasy.reactive.NoCache;

import java.util.Map;
import java.util.Optional;

@Path("/api")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class LoginResource {

    private static final String AUTH_COOKIE_NAME = "AuthToken";

    @Inject
    PasswordService passwordService;
    @Inject
    EmailService emailService;

    @ConfigProperty(name = "mp.jwt.expire-seconds", defaultValue = "3600")
    long tokenExpirySeconds;

    @ConfigProperty(name = "app.otp.expiry-seconds", defaultValue = "300")
    int otpExpirySeconds;

    @ConfigProperty(name = "app.login.max-failed-attempts", defaultValue = "5")
    int maxFailedAttempts;

    // ── POST /api/login ───────────────────────────────────────────────────────

    /**
     * Step 1 of login:
     * - Validates credentials
     * - If valid + user has email → sends OTP, returns {requiresOtp: true}
     * - If valid + no email     → issues JWT directly (legacy / no-email users)
     * - If mustChangePassword   → sets flag in response so frontend redirects
     */
    @POST
    @Path("/login")
    public Response login(LoginRequest request) {
        if (request == null) return badRequest("Invalid request");

        String username = trim(request.username());
        String password = request.password();

        if (isBlank(username)) return badRequest("Username is required");
        if (isBlank(password)) return badRequest("Password is required");

        Optional<AppUser> userOpt = AppUser.findByUsername(username.toUpperCase());

        // Constant-time failure — same response whether user exists or not
        if (userOpt.isEmpty()) {
            return unauthorized("Invalid credentials");
        }

        AppUser user = userOpt.get();

        // Check account lock
        if (user.isLocked()) {
            return Response.status(403).entity(Map.of(
                    "message", "Account locked after too many failed attempts. Contact your administrator.",
                    "code", "ACCOUNT_LOCKED"
            )).build();
        }

        // Verify password
        if (!passwordService.verify(password, user.getPasswordHash())) {
            user.recordFailedLogin(maxFailedAttempts);
            int remaining = Math.max(0, maxFailedAttempts - user.failedLoginCount);
            return Response.status(401).entity(Map.of(
                    "message", "Invalid credentials" + (remaining > 0 ? " (" + remaining + " attempts remaining)" : ""),
                    "code", "INVALID_CREDENTIALS"
            )).build();
        }

        // Credentials are correct — reset failed count
        // (full recordSuccessfulLogin() called after OTP, not here)

        // If user has an email, send OTP (MFA step)
        if (user.email != null && !user.email.isBlank()) {
            String otp = OtpToken.createOtp(user.username, otpExpirySeconds);
            emailService.sendOtp(user.email, user.username, otp);

            return Response.ok(Map.of(
                    "requiresOtp", true,
                    "username", user.getUsername(),
                    "message", "A verification code has been sent to your email"
            )).build();
        }

        // No email configured → issue JWT directly (and handle mustChangePassword)
        return issueJwt(user);
    }

    // ── POST /api/logout ──────────────────────────────────────────────────────

    @POST
    @Path("/logout")
    @NoCache
    public Response logout() {
        NewCookie cleared = new NewCookie.Builder(AUTH_COOKIE_NAME)
                .value("").path("/").maxAge(0).secure(false).httpOnly(true).build();

        return Response.ok(Map.of("message", "Logged out successfully"))
                .cookie(cleared)
                .header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
                .header("Pragma", "no-cache")
                .build();
    }

    // ── POST /api/status ──────────────────────────────────────────────────────

    @POST
    @Path("/status")
    public Response authStatus() {
        return Response.ok(Map.of("authenticated", true)).build();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    Response issueJwt(AppUser user) {
        String token = io.smallrye.jwt.build.Jwt.issuer("orange-bank-app")
                .upn(user.getUsername())
                .groups(user.getRole().name())
                .expiresAt(java.time.Instant.now().plusSeconds(tokenExpirySeconds))
                .sign();

        NewCookie authCookie = new NewCookie.Builder(AUTH_COOKIE_NAME)
                .value(token).path("/").maxAge((int) tokenExpirySeconds)
                .secure(false).httpOnly(true)
                .sameSite(NewCookie.SameSite.STRICT)
                .build();

        return Response.ok(Map.of(
                "username", user.getUsername(),
                "role", user.getRole().name(),
                "country", user.getCountryCode(),
                "mustChangePassword", user.mustChangePassword,
                "requiresOtp", false,
                "message", "Authentication successful"
        )).cookie(authCookie).build();
    }

    private Response badRequest(String msg) {
        return Response.status(400).entity(Map.of("message", msg)).build();
    }

    private Response unauthorized(String msg) {
        return Response.status(401).entity(Map.of("message", msg, "code", "INVALID_CREDENTIALS")).build();
    }

    private boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    private String trim(String s) {
        return s == null ? null : s.trim();
    }

    public record LoginRequest(String username, String password) {
    }
}