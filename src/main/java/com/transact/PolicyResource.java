package com.transact;

import com.transact.service.PasswordService;
import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Map;

/**
 * ADMIN endpoint for reading and updating the password policy at runtime.
 * Writes changes back to application.properties so they survive restarts.
 */
@Path("/api/v1/admin/policy")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class PolicyResource {

    private static final Logger LOG = Logger.getLogger(PolicyResource.class);

    @Inject
    PasswordService passwordService;

    @ConfigProperty(name = "app.password.min-length", defaultValue = "10")
    int minLength;
    @ConfigProperty(name = "app.password.require-digit", defaultValue = "true")
    boolean requireDigit;
    @ConfigProperty(name = "app.password.require-uppercase", defaultValue = "true")
    boolean requireUppercase;
    @ConfigProperty(name = "app.password.require-special", defaultValue = "true")
    boolean requireSpecial;

    /**
     * GET /api/admin/policy — returns current policy
     */
    @GET
    @RolesAllowed("ADMIN")
    public Response getPolicy() {
        return Response.ok(passwordService.getPolicy()).build();
    }

    /**
     * POST /api/admin/policy — update policy (persisted to config)
     */
    @POST
    @RolesAllowed("ADMIN")
    public Response updatePolicy(PolicyUpdateRequest req) {
        if (req == null)
            return Response.status(400).entity(Map.of("message", "Corps de requête manquant")).build();
        if (req.minLength() < 6 || req.minLength() > 32)
            return Response.status(400).entity(Map.of("message", "Longueur min. entre 6 et 32")).build();

        try {
            // Write to application.properties at runtime
            java.nio.file.Path propFile = Paths.get("src/main/resources/application.properties");
            if (!Files.exists(propFile)) {
                // Try classpath location
                propFile = Paths.get("config/application.properties");
            }

            if (Files.exists(propFile)) {
                String props = Files.readString(propFile);
                props = props.replaceAll("app\\.password\\.min-length=\\d+",
                        "app.password.min-length=" + req.minLength());
                props = props.replaceAll("app\\.password\\.require-digit=(true|false)",
                        "app.password.require-digit=" + req.requireDigit());
                props = props.replaceAll("app\\.password\\.require-uppercase=(true|false)",
                        "app.password.require-uppercase=" + req.requireUppercase());
                props = props.replaceAll("app\\.password\\.require-special=(true|false)",
                        "app.password.require-special=" + req.requireSpecial());
                Files.writeString(propFile, props);
                LOG.infof("[Policy] Updated: minLen=%d digit=%b upper=%b special=%b",
                        req.minLength(), req.requireDigit(), req.requireUppercase(), req.requireSpecial());
            }

            return Response.ok(Map.of(
                    "message", "Politique mise à jour. Redémarrage requis pour appliquer.",
                    "minLength", req.minLength(),
                    "requireDigit", req.requireDigit(),
                    "requireUppercase", req.requireUppercase(),
                    "requireSpecial", req.requireSpecial()
            )).build();

        } catch (Exception e) {
            LOG.errorf(e, "[Policy] Update failed");
            return Response.status(500).entity(Map.of("message", "Erreur lors de la mise à jour")).build();
        }
    }

    public record PolicyUpdateRequest(
            int minLength,
            boolean requireDigit,
            boolean requireUppercase,
            boolean requireSpecial
    ) {
    }
}
