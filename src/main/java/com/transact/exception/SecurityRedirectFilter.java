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
                        buildRedirect(req, "change-password")).build());
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

        String proto = resolveProto(requestContext);
        String host = resolveHost(requestContext);

        if (status == 401) {
            // Clear auth cookies
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
            responseContext.setStatus(302);
            responseContext.getHeaders().putSingle("Location",
                    proto + "://" + host + "/login?error=session_expired");

        } else if (status == 403) {
            // Wrong role trying to access a page — redirect to their home page
            boolean isApi = path.startsWith("/api/v1/");
            if (!isApi) {
                // Let MUST_CHANGE_PASSWORD 403 pass through (handled by request filter)
                Object body = responseContext.getEntity();
                if (body instanceof Map && ((Map<?, ?>) body).containsKey("code")
                        && "MUST_CHANGE_PASSWORD".equals(((Map<?, ?>) body).get("code"))) {
                    return;
                }
                responseContext.setStatus(302);
                responseContext.getHeaders().putSingle("Location",
                        proto + "://" + host + "/");
            }
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private URI buildRedirect(ContainerRequestContext req, String relativePath) {
        return URI.create(resolveProto(req) + "://" + resolveHost(req) + "/" + relativePath);
    }

    /**
     * Returns the external scheme from X-Forwarded-Proto, falling back to the
     * request's own scheme (always "https" when nginx terminates TLS).
     */
    private String resolveProto(ContainerRequestContext req) {
        String proto = req.getHeaderString("X-Forwarded-Proto");
        if (proto != null && !proto.isBlank()) return proto.trim();
        return req.getUriInfo().getBaseUri().getScheme();
    }

    /**
     * Returns the external "host:port" string so that redirect URLs always
     * include the correct port (e.g. "localhost:8443" not just "localhost").
     * <p>
     * Priority:
     * 1. X-Forwarded-Host  — nginx sets this to "$host:8443" which already
     * embeds the external port; use it as-is.
     * 2. Host + X-Forwarded-Port — nginx's $host strips the port, but
     * X-Forwarded-Port carries it separately; combine them.
     * 3. Host alone        — last resort when running without a proxy; the
     * port will be wrong behind nginx, but nginx's proxy_redirect rule
     * in nginx.conf will rewrite it as a safety net.
     * 4. Base URI authority — internal "localhost:8080", also caught by
     * nginx's proxy_redirect.
     */
    private String resolveHost(ContainerRequestContext req) {
        // 1. X-Forwarded-Host already contains "host:port"
        String fwdHost = req.getHeaderString("X-Forwarded-Host");
        if (fwdHost != null && !fwdHost.isBlank()) return fwdHost.trim();

        // 2. Host header + X-Forwarded-Port
        String host = req.getHeaderString("Host");
        String port = req.getHeaderString("X-Forwarded-Port");
        if (host != null && !host.isBlank()) {
            if (port != null && !port.isBlank() && !host.contains(":")) {
                return host.trim() + ":" + port.trim();
            }
            return host.trim();
        }

        // 3. Internal base URI authority (nginx proxy_redirect will rewrite)
        return req.getUriInfo().getBaseUri().getAuthority();
    }
}