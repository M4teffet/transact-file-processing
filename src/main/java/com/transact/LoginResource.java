package com.transact;

import com.transact.processor.model.AppUser;
import com.transact.processor.model.OtpToken;
import com.transact.service.EmailService;
import com.transact.service.PasswordService;
import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.NewCookie;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.resteasy.reactive.NoCache;

import java.util.Map;
import java.util.Optional;

@Path("/api/v1")
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

    @POST
    @Path("/login")
    public Response login(LoginRequest request) {
        if (request == null) return badRequest("Requête invalide");

        String username = trim(request.username());
        String password = request.password();

        if (isBlank(username)) return badRequest("Le nom d'utilisateur est requis");
        if (isBlank(password)) return badRequest("Le mot de passe est requis");

        Optional<AppUser> userOpt = AppUser.findByUsername(username.toUpperCase());

        if (userOpt.isEmpty()) {
            return unauthorized("Identifiants invalides");
        }

        AppUser user = userOpt.get();

        // Check account lock
        if (user.isLocked()) {
            return Response.status(403).entity(Map.of(
                    "message", "Compte verrouillé après trop de tentatives échouées. Contactez votre administrateur.",
                    "code", "ACCOUNT_LOCKED"
            )).build();
        }

        // Verify password
        if (!passwordService.verify(password, user.getPasswordHash())) {
            user.recordFailedLogin(maxFailedAttempts);
            int remaining = Math.max(0, maxFailedAttempts - user.failedLoginCount);
            return Response.status(401).entity(Map.of(
                    "message", "Identifiants invalides" + (remaining > 0 ? " (" + remaining + " tentatives restantes)" : ""),
                    "code", "INVALID_CREDENTIALS"
            )).build();
        }

        // If user has an email, send OTP
        if (user.email != null && !user.email.isBlank()) {
            String otp = OtpToken.createOtp(user.username, otpExpirySeconds);
            emailService.sendOtp(user.email, user.username, otp);

            return Response.ok(Map.of(
                    "requiresOtp", true,
                    "username", user.getUsername(),
                    "message", "Un code de vérification a été envoyé à votre adresse email"
            )).build();
        }

        // No email → issue JWT directly
        user.failedLoginCount = 0;
        user.update();
        return issueJwt(user);
    }

    // ── POST /api/logout ──────────────────────────────────────────────────────

    @POST
    @Path("/logout")
    @NoCache
    public Response logout() {
        NewCookie cleared = new NewCookie.Builder(AUTH_COOKIE_NAME)
                .value("").path("/").maxAge(0).secure(false).httpOnly(true).build();

        return Response.ok(Map.of("message", "Déconnexion réussie"))
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
                .claim("pwv", user.passwordVersion)
                .claim("mcp", user.mustChangePassword)
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
                "message", "Authentification réussie"
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