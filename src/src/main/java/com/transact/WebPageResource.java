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
    @Location("upload-salary")
    Template uploadSalaryTemplate;
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
    @Location("audit-trail")
    Template auditTrailTemplate;
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

    @GET
    @Path("/")
    @Authenticated
    @Produces(MediaType.TEXT_HTML)
    public jakarta.ws.rs.core.Response getRootPage() {
        String target;
        if (identity.hasRole("ADMIN")) target = "dashboard";
        else if (identity.hasRole("INPUTTER")) target = "upload";
        else if (identity.hasRole("AUTHORISER")) target = "validate";
        else target = "login";

        // Relative redirect: the browser resolves "/dashboard" against whatever
        // origin is in the address bar (nginx, ngrok tunnel, or direct), so we
        // never construct — and never leak — an internal host:port like :8443.
        return jakarta.ws.rs.core.Response
                .temporaryRedirect(java.net.URI.create("/" + target))
                .build();
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

    @GET
    @Path("/audit-trail")
    @RolesAllowed("ADMIN")
    @Produces(MediaType.TEXT_HTML)
    public TemplateInstance getAuditTrailPage() {
        return auditTrailTemplate.data("title", "Piste d'audit — Orange Bank").data("activePage", "audit-trail");
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
    @Path("/upload-salary")
    @RolesAllowed("INPUTTER")
    @Produces(MediaType.TEXT_HTML)
    public TemplateInstance getUploadSalaryPage() {
        return uploadSalaryTemplate.data("title", "Upload Salaire — Orange Bank").data("activePage", "upload-salary");
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
