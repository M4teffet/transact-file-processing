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

@Path("")
public class WebPageResource {

    @Inject
    @Location("upload")  // Finds src/main/resources/templates/upload.html
    Template uploadTemplate;

    @Inject
    @Location("validate")  // Finds src/main/resources/templates/validate.html
    Template validateTemplate;

    @Inject
    @Location("batches")  // Finds src/main/resources/templates/batches.html
    Template batchesTemplate;

    @Inject
    @Location("validated")  // Finds src/main/resources/templates/batches.html
    Template validatedTemplate;

    @Inject
    @Location("login")  // Finds src/main/resources/templates/login.html
    Template loginTemplate;

    @Inject
    @Location("dashboard")
    Template dashboardTemplate;

    @Inject
    @Location("settings")
    Template settingsTemplate;

    @GET
    @Path("/dashboard")
    @RolesAllowed({"ADMIN"})  // Nouveau rôle
    @Produces(MediaType.TEXT_HTML)
    public TemplateInstance getAdminPage() {

        return dashboardTemplate.data("title", "Administration - Batch Manager");
    }

    @GET
    @Path("/upload")
    @RolesAllowed("INPUTTER")
    @Produces(MediaType.TEXT_HTML)
    public TemplateInstance getUploadPage() {
        // Chain both .data() calls to the template instance before returning
        return uploadTemplate
                .data("title", "Import CSV & Modèles - Orange Bank");
    }

    @GET
    @Path("/validate")
    @Authenticated
    @Produces(MediaType.TEXT_HTML)
    public TemplateInstance getValidatePage() {
        // Chain both .data() calls to the template instance before returning
        return validateTemplate
                .data("title", "Validation CSV - Orange Bank");
    }

    @GET
    @Authenticated
    @Path("/batches")
    @Produces(MediaType.TEXT_HTML)
    public TemplateInstance getBatchesPage() {
        // Chain both .data() calls to the template instance before returning
        return batchesTemplate
                .data("title", "Lots en Attente - Orange Bank");
    }

    @GET
    @Authenticated
    @Path("/validated")
    @Produces(MediaType.TEXT_HTML)
    public TemplateInstance getValidatedPage() {
        // Chain both .data() calls to the template instance before returning
        return validatedTemplate
                .data("title", "Lots Validés - Orange Bank");
    }

    @GET
    @PermitAll
    @Path("/login")
    @Produces(MediaType.TEXT_HTML)
    public TemplateInstance getLoginPage() {
        // Chain both .data() calls to the template instance before returning
        return loginTemplate
                .data("title", "Connexion - Orange Bank");
    }

    @GET
    @PermitAll
    @Path("/settings")
    @Produces(MediaType.TEXT_HTML)
    public TemplateInstance getSettingsPage() {
        // Chain both .data() calls to the template instance before returning
        return settingsTemplate
                .data("title", "Administration - Batch Manager Settings");
    }
}