package com.transact;

import com.transact.processor.model.AppUser;
import io.smallrye.jwt.build.Jwt;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.NewCookie;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.resteasy.reactive.NoCache;
import org.mindrot.jbcrypt.BCrypt;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;

@Path("/api")
public class LoginResource {

    // The name of the cookie we will use for authentication
    private static final String AUTH_COOKIE_NAME = "AuthToken";
    // Time until the JWT and the cookie expire (in seconds)
    @ConfigProperty(name = "mp.jwt.expire-seconds", defaultValue = "3600")  // Increased to 1 hour for usability
            long tokenExpirySeconds;

    @POST
    @Path("/login")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response login(LoginRequest request) {

        // 1️⃣ Validate input safely (NO exceptions)
        if (request == null) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity(Map.of("message", "Invalid request payload"))
                    .build();
        }

        String username = Optional.ofNullable(request.username)
                .map(String::trim)
                .orElse("");

        String password = Optional.ofNullable(request.password)
                .map(String::trim)
                .orElse("");

        if (username.isEmpty()) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity(Map.of("message", "Username is required"))
                    .build();
        }

        if (password.isEmpty()) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity(Map.of("message", "Password is required"))
                    .build();
        }

        if (username.length() < 3 || username.length() > 50) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity(Map.of("message", "Username must be 3-50 characters"))
                    .build();
        }

        if (password.length() < 8) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity(Map.of("message", "Password must be at least 8 characters"))
                    .build();
        }

        // 2️⃣ Authenticate
        Optional<AppUser> userOpt = AppUser.findByUsername(username);
        if (userOpt.isEmpty()) {
            return Response.status(Response.Status.UNAUTHORIZED)
                    .entity(Map.of("message", "Invalid credentials"))
                    .build();
        }

        AppUser user = userOpt.get();
        if (!BCrypt.checkpw(password, user.getPasswordHash())) {
            return Response.status(Response.Status.UNAUTHORIZED)
                    .entity(Map.of("message", "Invalid credentials"))
                    .build();
        }

        // 3️⃣ Generate JWT
        String token = Jwt.issuer("orange-bank-app")
                .upn(user.getUsername())
                .groups(user.getRole().name())
                .expiresAt(Instant.now().plusSeconds(tokenExpirySeconds))
                .sign();

        // 4️⃣ Secure cookie
        NewCookie authCookie = new NewCookie.Builder(AUTH_COOKIE_NAME)
                .value(token)
                .path("/")
                .maxAge((int) tokenExpirySeconds)
                .secure(false)        // true in prod (HTTPS)
                .httpOnly(true)
                .sameSite(NewCookie.SameSite.STRICT)
                .build();

        // 5️⃣ Response body (safe)
        return Response.ok(Map.of(
                        "username", user.getUsername(),
                        "role", user.getRole().name(),
                        "message", "Authentication successful"
                ))
                .cookie(authCookie)
                .build();
    }


    @POST
    @Path("/logout")
    @Consumes(MediaType.APPLICATION_JSON)  // Optional; accepts empty JSON {} if needed
    @Produces(MediaType.APPLICATION_JSON)
    @NoCache  // Prevents caching of logout response
    public Response logout() {
        // 1. Create a cleared cookie (maxAge=0 deletes it client-side)
        NewCookie clearedCookie = new NewCookie.Builder(AUTH_COOKIE_NAME)
                .value("")  // Empty value
                .path("/")
                .maxAge(0)  // Immediate expiry
                .secure(false)  // Match login's secure flag (true in prod)
                .httpOnly(true)
                .build();

        // 2. Response with cleared cookie, success message, and anti-caching headers
        Map<String, Object> responseBody = Map.of(
                "message", "Logged out successfully."
        );

        return Response.ok(responseBody)
                .cookie(clearedCookie)
                .header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
                .header("Pragma", "no-cache")
                .header("Expires", "0")
                .build();
    }

    // Simple auth status check for client-side back navigation detection
    @POST  // Use POST for consistency, or GET if preferred
    @Path("/status")
    @Produces(MediaType.APPLICATION_JSON)
    public Response authStatus() {
        // If this endpoint is reached, user is authenticated (via JWT cookie)
        return Response.ok(Map.of("authenticated", true)).build();
    }

    public static class LoginRequest {
        public String username;
        public String password;
    }
}