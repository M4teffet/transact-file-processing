package com.transact.exception;

import com.transact.processor.model.AppUser;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.inject.Inject;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.container.ContainerResponseContext;
import jakarta.ws.rs.container.ContainerResponseFilter;
import jakarta.ws.rs.core.Cookie;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.Provider;
import org.eclipse.microprofile.jwt.JsonWebToken;

import java.util.Map;
import java.util.Set;

/**
 * Two-phase security filter:
 * <p>
 * REQUEST phase  — enforce mustChangePassword and passwordVersion on every
 * authenticated API/page request.
 * RESPONSE phase — on 401, clear stale auth cookies and redirect to login.
 */
@Provider
public class SecurityRedirectFilter implements ContainerRequestFilter, ContainerResponseFilter {

    private static final String EXPIRED_DATE = "Thu, 01 Jan 1970 00:00:00 GMT";
    private static final String[] AUTH_COOKIES = {"quarkus-credential", "quarkus-redirect-location", "JSESSIONID"};

    /** Paths that must remain accessible regardless of mustChangePassword or pwv */
    private static final Set<String> ALWAYS_ALLOWED = Set.of(
            "login", "forgot-password", "reset-password", "change-password",
            "closed", "access-denied",
            "api/login", "api/logout", "api/status",
            "api/auth/change-password", "api/auth/forgot-password",
            "api/auth/reset-password", "api/auth/verify-otp",
            "api/auth/resend-otp", "api/auth/password-policy",
            "css/", "javascript/", "images/", "favicon.ico", "q/health"
    );

    @Inject
    SecurityIdentity identity;

    @Inject
    JsonWebToken jwt;

    // ── REQUEST filter ────────────────────────────────────────────────────────

    @Override
    public void filter(ContainerRequestContext req) {
        if (identity == null || identity.isAnonymous()) return;

        String path = req.getUriInfo().getPath().replaceFirst("^/", "");

        // Let always-allowed paths through
        for (String allowed : ALWAYS_ALLOWED) {
            if (path.startsWith(allowed)) return;
        }

        String username = identity.getPrincipal().getName();
        AppUser user = AppUser.findByUsername(username).orElse(null);
        if (user == null) return;

        // ── 1. mustChangePassword ─────────────────────────────────────────────
        if (user.mustChangePassword) {
            boolean isApi = path.startsWith("api/");
            if (isApi) {
                req.abortWith(Response.status(403)
                        .type(MediaType.APPLICATION_JSON)
                        .entity(Map.of(
                                "code", "MUST_CHANGE_PASSWORD",
                                "message", "Vous devez changer votre mot de passe avant de continuer."
                        )).build());
            } else {
                req.abortWith(Response.temporaryRedirect(
                        req.getUriInfo().getBaseUri().resolve("change-password")
                ).build());
            }
            return;
        }

        // ── 2. passwordVersion — reject tokens issued before the last password change
        long tokenPwv = 0;
        try {
            Number claim = (Number) jwt.claim("pwv").orElse(null);
            if (claim != null) tokenPwv = claim.longValue();
        } catch (Exception ignored) {
        }

        if (tokenPwv < user.passwordVersion) {
            boolean isApi = path.startsWith("api/");
            if (isApi) {
                req.abortWith(Response.status(401)
                        .type(MediaType.APPLICATION_JSON)
                        .entity(Map.of(
                                "code", "SESSION_INVALIDATED",
                                "message", "Votre session a été invalidée. Veuillez vous reconnecter."
                        )).build());
            } else {
                req.abortWith(Response.temporaryRedirect(
                        req.getUriInfo().getBaseUri().resolve("login?error=session_expired")
                ).build());
            }
        }
    }

    // ── RESPONSE filter ───────────────────────────────────────────────────────

    @Override
    public void filter(ContainerRequestContext requestContext,
                       ContainerResponseContext responseContext) {

        int status = responseContext.getStatus();
        String path = requestContext.getUriInfo().getPath();

        if (status == 401 && !"/login".equals(path)) {
            Map<String, Cookie> cookies = requestContext.getCookies();
            boolean isSecure = "https".equals(requestContext.getUriInfo().getRequestUri().getScheme());
            String secureFlag = isSecure ? "; Secure" : "";
            for (String cookieName : AUTH_COOKIES) {
                if (cookies.containsKey(cookieName)) {
                    Cookie cookie = cookies.get(cookieName);
                    String cookiePath = cookie.getPath() != null ? cookie.getPath() : "/";
                    String cookieDomain = cookie.getDomain() != null ? "; Domain=" + cookie.getDomain() : "";
                    responseContext.getHeaders().add("Set-Cookie",
                            cookieName + "=; Path=" + cookiePath + cookieDomain +
                                    "; Expires=" + EXPIRED_DATE + secureFlag + "; HttpOnly");
                }
            }
            responseContext.setStatus(302);
            responseContext.getHeaders().putSingle("Location", "/login?error=session_expired");
        }
    }
}
