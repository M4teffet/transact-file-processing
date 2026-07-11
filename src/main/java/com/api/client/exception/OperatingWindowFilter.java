package com.api.client.exception;

import com.transact.processor.model.OperatingWindow;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.Priority;
import jakarta.inject.Inject;
import jakarta.ws.rs.Priorities;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.Provider;

import java.net.URI;
import java.util.Map;

/**
 * OperatingWindowFilter — enforces the application wind-down.
 * <p>
 * Runs after authentication: ADMIN passes always; INPUTTER/AUTHORISER are
 * blocked outside service hours (API calls get 403 JSON, page navigations
 * get redirected to /closed). Anonymous traffic (login flow, static assets)
 * is never blocked here — a freshly logged-in non-admin simply lands on
 * /closed at their first authenticated request.
 */
@Provider
@Priority(Priorities.AUTHORIZATION + 10)
public class OperatingWindowFilter implements ContainerRequestFilter {

    private static final String[] EXEMPT_PREFIXES = {
            "login", "forgot-password", "reset-password", "closed", "access-denied",
            "css/", "javascript/", "images/", "favicon.ico",
            "api/v1/login", "api/v1/logout", "api/v1/status", "api/v1/auth/",
            "api/v1/admin/operating-window/status",
            "api/v1/admin/", "q/health"
    };

    @Inject
    SecurityIdentity identity;

    @org.eclipse.microprofile.config.inject.ConfigProperty(name = "app.internal-ports", defaultValue = "8443,8080")
    java.util.List<Integer> internalPorts;

    @Override
    public void filter(ContainerRequestContext ctx) {
        String path = ctx.getUriInfo().getPath();
        if (path.startsWith("/")) path = path.substring(1);

        for (String exempt : EXEMPT_PREFIXES) {
            if (path.startsWith(exempt)) return;
        }

        // Unauthenticated requests fall through to the normal auth layer.
        if (identity == null || identity.isAnonymous()) return;

        // Admin is never locked out.
        if (identity.hasRole("ADMIN")) return;

        OperatingWindow window = OperatingWindow.get();
        if (window.isOpenNow()) return;

        if (path.startsWith("api/v1/")) {
            ctx.abortWith(Response.status(403)
                    .type(MediaType.APPLICATION_JSON)
                    .entity(Map.of(
                            "error", "SERVICE_CLOSED",
                            "message", String.format(
                                    "Service fermé. Heures d'ouverture : %02dh00 – %02dh00.",
                                    window.openHour, window.closeHour)
                    ))
                    .build());
        } else {
            ctx.abortWith(Response.status(302)
                    .location(buildRedirect(ctx, "closed"))
                    .build());
        }
    }

    private URI buildRedirect(ContainerRequestContext ctx, String relativePath) {
        String proto = ctx.getHeaderString("X-Forwarded-Proto");
        if (proto == null || proto.isBlank()) proto = ctx.getUriInfo().getBaseUri().getScheme();

        String host = ctx.getHeaderString("X-Forwarded-Host");
        if (host == null || host.isBlank()) host = ctx.getHeaderString("Host");
        if (host == null || host.isBlank()) host = ctx.getUriInfo().getBaseUri().getAuthority();
        if (host != null) {
            host = host.trim();
            int comma = host.indexOf(',');
            if (comma >= 0) host = host.substring(0, comma).trim();
            host = stripInternalPort(host, proto);
        }
        return URI.create(proto + "://" + host + "/" + relativePath);
    }

    /**
     * Remove the port when it's the scheme default (443/80) or the app's internal
     * listen port (8443/8080), so an HTTPS tunnel like ngrok — which forwards
     * https://xxx.ngrok-free.app → https://localhost:8443 — never leaks :8443
     * into the public redirect URL.
     */
    private String stripInternalPort(String host, String proto) {
        int colon = host.lastIndexOf(':');
        if (colon < 0 || host.indexOf(':') != colon) return host; // no port / IPv6
        String name = host.substring(0, colon);
        int port;
        try {
            port = Integer.parseInt(host.substring(colon + 1));
        } catch (NumberFormatException e) {
            return host;
        }
        int defaultPort = "https".equalsIgnoreCase(proto) ? 443 : 80;
        if (port == defaultPort || internalPorts.contains(port)) return name;
        return host;
    }
}
