package com.transact;

import com.transact.processor.model.PasswordPolicyEntity;
import com.transact.service.PasswordService;
import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;
import org.jboss.logging.Logger;

import java.util.Map;

/**
 * ADMIN endpoint for reading and updating the password policy at runtime.
 *
 * Policy is persisted to MongoDB (password_policy collection) so it survives
 * server restarts and works correctly inside Docker / JAR deployments.
 *
 * The old implementation wrote to application.properties at runtime, which
 * failed silently in production because:
 *   1. The JAR is read-only — file writes are a no-op or throw.
 *   2. @ConfigProperty values are injected once at startup; even a successful
 *      write only takes effect after a full restart.
 */
@Path("/api/v1/admin/policy")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Tag(name = "Politique de sécurité")
public class PolicyResource {

    private static final Logger LOG = Logger.getLogger(PolicyResource.class);

    @Inject
    PasswordService passwordService;

    /**
     * GET /api/v1/admin/policy — returns the current active policy.
     * Always reads from MongoDB so the UI reflects what was last saved.
     */
    @GET
    @RolesAllowed("ADMIN")
    @Operation(summary = "Lire la politique de mot de passe active")
    public Response getPolicy() {
        return Response.ok(passwordService.getPolicy()).build();
    }

    /**
     * POST /api/v1/admin/policy — persist an updated policy to MongoDB.
     * Takes effect immediately on the next password operation — no restart needed.
     */
    @POST
    @RolesAllowed("ADMIN")
    @Operation(summary = "Mettre à jour la politique de mot de passe")
    public Response updatePolicy(PolicyUpdateRequest req) {
        if (req == null)
            return Response.status(400)
                    .entity(Map.of("message", "Corps de requête manquant")).build();
        if (req.minLength() < 6 || req.minLength() > 32)
            return Response.status(400)
                    .entity(Map.of("message", "Longueur min. doit être entre 6 et 32")).build();

        try {
            // Build and upsert the policy document
            PasswordPolicyEntity policy = new PasswordPolicyEntity();
            policy.minLength = req.minLength();
            policy.requireDigit = req.requireDigit();
            policy.requireUppercase = req.requireUppercase();
            policy.requireSpecial = req.requireSpecial();
            policy.save();

            LOG.infof("[Policy] Updated → minLen=%d digit=%b upper=%b special=%b",
                    req.minLength(), req.requireDigit(), req.requireUppercase(), req.requireSpecial());

            return Response.ok(Map.of(
                    "message", "Politique mise à jour avec succès",
                    "minLength", req.minLength(),
                    "requireDigit", req.requireDigit(),
                    "requireUppercase", req.requireUppercase(),
                    "requireSpecial", req.requireSpecial()
            )).build();

        } catch (Exception e) {
            LOG.errorf(e, "[Policy] Échec de la mise à jour");
            return Response.status(500)
                    .entity(Map.of("message", "Erreur lors de la sauvegarde de la politique")).build();
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
