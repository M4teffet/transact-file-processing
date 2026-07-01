package com.transact;

import io.quarkus.qute.Location;
import io.quarkus.qute.Template;
import io.quarkus.qute.TemplateInstance;
import io.quarkus.security.Authenticated;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.security.PermitAll;
import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;

@Path("/")
public class WebPageResource {

    @Inject
    SecurityIdentity identity;

    @Inject
    @Location("dashboard")
    Template dashboardTemplate;
    @Inject
    @Location("upload")
    Template uploadTemplate;
    @Inject
    @Location("validate")
    Template validateTemplate;
    @Inject
    @Location("batches")
    Template batchesTemplate;
    @Inject
    @Location("validated")
    Template validatedTemplate;
    @Inject
    @Location("login")
    Template loginTemplate;
    @Inject
    @Location("settings")
    Template settingsTemplate;
    @Inject
    @Location("reports")
    Template reportsTemplate;
    @Inject
    @Location("access-denied")
    Template accessDeniedTemplate;
    @Inject
    @Location("closed")
    Template closedTemplate;
    @Inject
    @Location("change-password")
    Template changePasswordTemplate;
    @Inject
    @Location("forgot-password")
    Template forgotPasswordTemplate;
    @Inject
    @Location("reset-password")
    Template resetPasswordTemplate;
    @Inject
    @Location("sidebar-admin")
    Template sidebarAdminTemplate;
    @Inject
    @Location("sidebar-inputter")
    Template sidebarInputterTemplate;
    @Inject
    @Location("sidebar-authoriser")
    Template sidebarAuthoriserTemplate;

    // ── Root redirect — sends each role to their home page ────────────────────

    @Location("audit-trail")
    Template auditTrailTemplate;

    @GET
    @Path("/")
    @Authenticated
    @Produces(MediaType.TEXT_HTML)
    public jakarta.ws.rs.core.Response getRootPage(
            @jakarta.ws.rs.core.Context jakarta.ws.rs.core.UriInfo uriInfo,
            @jakarta.ws.rs.core.Context jakarta.ws.rs.core.HttpHeaders headers) {

        String target;
        if (identity.hasRole("ADMIN")) target = "dashboard";
        else if (identity.hasRole("INPUTTER")) target = "upload";
        else if (identity.hasRole("AUTHORISER")) target = "validate";
        else target = "login";

        return jakarta.ws.rs.core.Response.temporaryRedirect(
                buildExternalUri(uriInfo, headers, target)
        ).build();
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    @GET
    @Path("/dashboard")
    @RolesAllowed("ADMIN")
    @Produces(MediaType.TEXT_HTML)
    public TemplateInstance getAdminPage() {
        return dashboardTemplate.data("title", "Tableau de bord — Orange Bank").data("activePage", "dashboard");
    }

    @GET
    @Path("/settings")
    @RolesAllowed("ADMIN")
    @Produces(MediaType.TEXT_HTML)
    public TemplateInstance getSettingsPage() {
        return settingsTemplate.data("title", "Paramètres — Orange Bank").data("activePage", "settings");
    }

    @GET
    @Path("/reports")
    @RolesAllowed("ADMIN")
    @Produces(MediaType.TEXT_HTML)
    public TemplateInstance getReportPage() {
        return reportsTemplate.data("title", "Rapports — Orange Bank").data("activePage", "reports");
    }

    // ── Operations ────────────────────────────────────────────────────────────

    @GET
    @Path("/upload")
    @RolesAllowed("INPUTTER")
    @Produces(MediaType.TEXT_HTML)
    public TemplateInstance getUploadPage() {
        return uploadTemplate.data("title", "Upload — Orange Bank").data("activePage", "upload");
    }

    @GET
    @Path("/validate")
    @RolesAllowed("AUTHORISER")
    @Produces(MediaType.TEXT_HTML)
    public TemplateInstance getValidatePage() {
        return validateTemplate.data("title", "Validation — Orange Bank").data("activePage", "validate");
    }

    @GET
    @Path("/batches")
    @RolesAllowed({"INPUTTER", "AUTHORISER"})
    @Produces(MediaType.TEXT_HTML)
    public TemplateInstance getBatchesPage() {
        return batchesTemplate.data("title", "Batches — Orange Bank").data("activePage", "batches");
    }

    @GET
    @Path("/validated")
    @RolesAllowed("AUTHORISER")
    @Produces(MediaType.TEXT_HTML)
    public TemplateInstance getValidatedPage() {
        return validatedTemplate.data("title", "Validés — Orange Bank").data("activePage", "validated");
    }

    // ── Public / Auth flow ────────────────────────────────────────────────────

    @GET
    @Path("/login")
    @PermitAll
    @Produces(MediaType.TEXT_HTML)
    public TemplateInstance getLoginPage() {
        return loginTemplate.data("title", "Connexion — Orange Bank");
    }

    @GET
    @Path("/change-password")
    @PermitAll
    @Produces(MediaType.TEXT_HTML)
    public TemplateInstance getChangePasswordPage() {
        return changePasswordTemplate.data("title", "Mot de passe — Orange Bank");
    }

    @GET
    @Path("/forgot-password")
    @PermitAll
    @Produces(MediaType.TEXT_HTML)
    public TemplateInstance getForgotPasswordPage() {
        return forgotPasswordTemplate.data("title", "Mot de passe oublié — Orange Bank");
    }

    @GET
    @Path("/reset-password")
    @PermitAll
    @Produces(MediaType.TEXT_HTML)
    public TemplateInstance getResetPasswordPage() {
        return resetPasswordTemplate.data("title", "Réinitialisation — Orange Bank");
    }

    // ── Utility ───────────────────────────────────────────────────────────────

    /**
     * Builds an absolute redirect URI that works correctly behind nginx.
     * <p>
     * The root cause of https://localhost/validate (wrong port) is that Java's
     * URI.getHost() silently drops the port, and Quarkus's UriInfo does not
     * reliably inherit the external port from X-Forwarded-Host when only
     * proxy-address-forwarding is enabled.
     * <p>
     * Solution: read the forwarded headers directly.
     * X-Forwarded-Proto  → "https"            (set by nginx proxy_params)
     * X-Forwarded-Host   → "localhost:8443"   (set by nginx proxy_params)
     * X-Forwarded-Port   → "8443"             (set by nginx proxy_params, fallback)
     */
    private java.net.URI buildExternalUri(
            jakarta.ws.rs.core.UriInfo uriInfo,
            jakarta.ws.rs.core.HttpHeaders headers,
            String path) {

        // ── scheme ────────────────────────────────────────────────────────────
        String proto = headers.getHeaderString("X-Forwarded-Proto");
        if (proto == null || proto.isBlank()) {
            proto = uriInfo.getBaseUri().getScheme();
        }

        // ── host (with port) ──────────────────────────────────────────────────
        // X-Forwarded-Host is set by nginx as "$host:8443" — it already
        // contains the external port, so use it directly when available.
        String host = headers.getHeaderString("X-Forwarded-Host");
        if (host == null || host.isBlank()) {
            // Host header set by nginx is $host (hostname only, no port).
            // Combine it with X-Forwarded-Port to reconstruct "host:port".
            String rawHost = headers.getHeaderString("Host");
            String fwdPort = headers.getHeaderString("X-Forwarded-Port");
            if (rawHost != null && !rawHost.isBlank()) {
                host = (fwdPort != null && !fwdPort.isBlank() && !rawHost.contains(":"))
                        ? rawHost + ":" + fwdPort
                        : rawHost;
            }
        }
        // Last resort: use the internal authority — nginx proxy_redirect will
        // rewrite it to the correct external URL (see nginx.conf).
        if (host == null || host.isBlank()) {
            host = uriInfo.getBaseUri().getAuthority();
        }

        return java.net.URI.create(proto + "://" + host + "/" + path);
    }

    @GET
    @Path("/audit-trail")
    @Location("audit-trail")
    @RolesAllowed("ADMIN")
    public TemplateInstance auditTrail() {
        return auditTrailTemplate.data("activePage", "audit-trail");
    }

    @GET
    @Path("/access-denied")
    @Authenticated
    @Produces(MediaType.TEXT_HTML)
    public TemplateInstance getAccessDeniedPage() {
        return accessDeniedTemplate.data("title", "Accès refusé — Orange Bank");
    }

    @GET
    @Path("/closed")
    @PermitAll
    @Produces(MediaType.TEXT_HTML)
    public TemplateInstance getClosedPage() {
        com.transact.processor.model.OperatingWindow w =
                com.transact.processor.model.OperatingWindow.get();
        return closedTemplate
                .data("openHour", String.format("%02dh00", w.openHour))
                .data("closeHour", String.format("%02dh00", w.closeHour));
    }
}
