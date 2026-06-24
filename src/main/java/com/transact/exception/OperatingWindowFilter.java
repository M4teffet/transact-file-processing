package com.transact.exception;

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
        // Host header already contains host:port (e.g. 10.213.61.117:8443)
        String host = ctx.getHeaderString("X-Forwarded-Host");
        if (host == null || host.isBlank()) host = ctx.getHeaderString("Host");
        if (host == null || host.isBlank()) host = ctx.getUriInfo().getBaseUri().getHost();
        return URI.create(proto + "://" + host + "/" + relativePath);
    }
}
