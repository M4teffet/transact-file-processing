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
            "api/login", "api/logout", "api/status",
            "api/auth/", "css/", "javascript/", "images/", "favicon.ico", "q/"
    );

    @Inject
    SecurityIdentity identity;

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

        AppUser user = AppUser.findByUsername(username).orElse(null);
        if (user == null) return;

        // Enforce password change on first login
        if (user.mustChangePassword) {
            if (path.startsWith("api/")) {
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
        if (status != 401 || "/login".equals(path)) return;

        // Clear auth cookies
        Map<String, Cookie> cookies = requestContext.getCookies();
        String proto = requestContext.getHeaderString("X-Forwarded-Proto");
        if (proto == null || proto.isBlank()) {
            proto = requestContext.getUriInfo().getRequestUri().getScheme();
        }
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

        // Redirect to login using correct scheme
        String host = requestContext.getHeaderString("Host");
        if (host == null) host = requestContext.getUriInfo().getBaseUri().getHost();
        responseContext.setStatus(302);
        responseContext.getHeaders().putSingle("Location",
                proto + "://" + host + "/login?error=session_expired");
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private URI buildRedirect(ContainerRequestContext req, String relativePath) {
        String proto = req.getHeaderString("X-Forwarded-Proto");
        if (proto == null || proto.isBlank()) proto = req.getUriInfo().getBaseUri().getScheme();
        String host = req.getHeaderString("Host");
        if (host == null) host = req.getUriInfo().getBaseUri().getHost();
        return URI.create(proto + "://" + host + "/" + relativePath);
    }
}
