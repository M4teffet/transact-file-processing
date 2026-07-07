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

import java.net.URI;
import java.util.Map;
import java.util.Set;

@Provider
public class SecurityRedirectFilter implements ContainerRequestFilter, ContainerResponseFilter {

    private static final String EXPIRED_DATE = "Thu, 01 Jan 1970 00:00:00 GMT";
    private static final String[] AUTH_COOKIES = {"quarkus-credential", "quarkus-redirect-location", "JSESSIONID"};

    private static final Set<String> ALWAYS_ALLOWED = Set.of(
            "login", "forgot-password", "reset-password", "change-password",
            "closed", "access-denied",
            "api/v1/login", "api/v1/logout", "api/v1/status",
            "api/v1/auth/", "css/", "javascript/", "images/", "favicon.ico", "q/"
    );

    @Inject
    SecurityIdentity identity;

    @Inject
    org.eclipse.microprofile.jwt.JsonWebToken jwt;

    // ── REQUEST filter ────────────────────────────────────────────────────────

    @Override
    public void filter(ContainerRequestContext req) {
        if (identity == null || identity.isAnonymous()) return;

        String path = req.getUriInfo().getPath().replaceFirst("^/", "");

        for (String allowed : ALWAYS_ALLOWED) {
            if (path.startsWith(allowed)) return;
        }

        String username = identity.getPrincipal().getName();
        if (username == null || username.isBlank()) return;

        // Fast path: check mustChangePassword from JWT claim if available (avoids DB hit per request)
        // Falls back to DB lookup if claim not present (e.g. old tokens)
        Boolean jwtMustChange = null;
        try {
            Object claim = jwt.claim("mcp").orElse(null);
            if (claim instanceof Boolean) jwtMustChange = (Boolean) claim;
        } catch (Exception ignored) {
        }

        boolean mustChange;
        if (jwtMustChange != null) {
            mustChange = jwtMustChange;
        } else {
            AppUser user = AppUser.findByUsername(username).orElse(null);
            if (user == null) return;
            mustChange = user.mustChangePassword;
        }

        if (mustChange) {
            if (path.startsWith("api/v1/")) {
                req.abortWith(Response.status(403)
                        .type(MediaType.APPLICATION_JSON)
                        .entity(Map.of(
                                "code", "MUST_CHANGE_PASSWORD",
                                "message", "Vous devez changer votre mot de passe avant de continuer."
                        )).build());
            } else {
                req.abortWith(Response.temporaryRedirect(
                        URI.create("/change-password")).build());
            }
        }
    }

    // ── RESPONSE filter ───────────────────────────────────────────────────────

    @Override
    public void filter(ContainerRequestContext requestContext,
                       ContainerResponseContext responseContext) {

        int status = responseContext.getStatus();
        String path = requestContext.getUriInfo().getPath();
        if (path.equals("/login")) return;

        // API requests (fetch/XHR, Accept: application/json) must receive the
        // JSON error as-is. Converting them into a 302 → HTML /login page breaks
        // content negotiation (the JSON fetch can't consume HTML → 406 "accept
        // header did not match @Produces") and hides the real error from the UI.
        // Only browser PAGE navigations get redirected.
        boolean isApi = path.startsWith("/api/") || path.startsWith("api/");

        // ── TEMPORARY DIAGNOSTIC — remove once confirmed ──
        if (status == 401 || status == 403 || status == 406) {
            io.quarkus.logging.Log.errorf("[DIAG-FILTER] path=%s status=%d isApi=%b", path, status, isApi);
        }

        String proto = resolveProto(requestContext);

        if (status == 401) {
            // Clear auth cookies (applies to both API and page, harmless on API)
            Map<String, Cookie> cookies = requestContext.getCookies();
            String secureFlag = "https".equals(proto) ? "; Secure" : "";
            for (String cookieName : AUTH_COOKIES) {
                if (cookies.containsKey(cookieName)) {
                    Cookie cookie = cookies.get(cookieName);
                    String cookiePath = cookie.getPath() != null ? cookie.getPath() : "/";
                    String cookieDomain = cookie.getDomain() != null ? "; Domain=" + cookie.getDomain() : "";
                    responseContext.getHeaders().add("Set-Cookie",
                            cookieName + "=; Path=" + cookiePath + cookieDomain
                                    + "; Expires=" + EXPIRED_DATE + secureFlag + "; HttpOnly");
                }
            }
            // Redirect only real page loads; leave the API's JSON 401 untouched.
            if (!isApi) {
                responseContext.setStatus(302);
                responseContext.getHeaders().putSingle("Location", "/login?error=session_expired");
            }

        } else if (status == 403) {
            // Wrong role trying to access a page — redirect to their home page
            if (!isApi) {
                // Let MUST_CHANGE_PASSWORD 403 pass through (handled by request filter)
                Object body = responseContext.getEntity();
                if (body instanceof Map && ((Map<?, ?>) body).containsKey("code")
                        && "MUST_CHANGE_PASSWORD".equals(((Map<?, ?>) body).get("code"))) {
                    return;
                }
                responseContext.setStatus(302);
                responseContext.getHeaders().putSingle("Location", "/");
            }
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * Returns the external scheme from X-Forwarded-Proto (used only to set the
     * Secure flag when clearing cookies). Redirects themselves are relative, so
     * no host/port reconstruction is needed.
     */
    private String resolveProto(ContainerRequestContext req) {
        String proto = req.getHeaderString("X-Forwarded-Proto");
        if (proto != null && !proto.isBlank()) return proto.trim();
        return req.getUriInfo().getBaseUri().getScheme();
    }
}