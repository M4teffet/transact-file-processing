import io.quarkus.qute.Location;
import io.quarkus.qute.Template;
import io.quarkus.qute.TemplateInstance;
import io.quarkus.security.Authenticated;
import jakarta.annotation.security.PermitAll;
import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;

@Path("/")
public class WebPageResource {

    // --- Template Injections ---

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

    // --- Admin Endpoints ---

    @GET
    @Path("/dashboard")
    @RolesAllowed("ADMIN")
    @Produces(MediaType.TEXT_HTML)
    public TemplateInstance getAdminPage() {
        return dashboardTemplate.data("title", "Administration - Batch Manager");
    }

    @GET
    @Path("/settings")
    @RolesAllowed("ADMIN")
    @Produces(MediaType.TEXT_HTML)
    public TemplateInstance getSettingsPage() {
        return settingsTemplate.data("title", "Paramètres - Batch Manager");
    }

    @GET
    @Path("/reports")
    @RolesAllowed("ADMIN")
    @Produces(MediaType.TEXT_HTML)
    public TemplateInstance getReportPage() {
        return reportsTemplate.data("title", "Rapports - Batch Manager");
    }

    // --- Operations Endpoints ---

    @GET
    @Path("/upload")
    @RolesAllowed("INPUTTER")
    @Produces(MediaType.TEXT_HTML)
    public TemplateInstance getUploadPage() {
        return uploadTemplate.data("title", "Import CSV & Modèles - Orange Bank");
    }

    @GET
    @Path("/validate")
    @Authenticated
    @Produces(MediaType.TEXT_HTML)
    public TemplateInstance getValidatePage() {
        return validateTemplate.data("title", "Validation CSV - Orange Bank");
    }

    @GET
    @Path("/batches")
    @Authenticated
    @Produces(MediaType.TEXT_HTML)
    public TemplateInstance getBatchesPage() {
        return batchesTemplate.data("title", "Lots en Attente - Orange Bank");
    }

    @GET
    @Path("/validated")
    @Authenticated
    @Produces(MediaType.TEXT_HTML)
    public TemplateInstance getValidatedPage() {
        return validatedTemplate.data("title", "Lots Validés - Orange Bank");
    }

    // --- Public & Utility Endpoints ---

    @GET
    @Path("/login")
    @PermitAll
    @Produces(MediaType.TEXT_HTML)
    public TemplateInstance getLoginPage() {
        return loginTemplate.data("title", "Connexion - Orange Bank");
    }

    @GET
    @Path("/access-denied")
    @Authenticated
    @Produces(MediaType.TEXT_HTML)
    public TemplateInstance getAccessDeniedPage() {
        return accessDeniedTemplate.data("title", "Accès Non Autorisé");
    }
}