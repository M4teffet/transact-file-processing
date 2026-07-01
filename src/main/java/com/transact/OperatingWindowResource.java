package com.transact;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.transact.processor.model.AdminAuditLog;
import com.transact.processor.model.OperatingWindow;
import com.transact.processor.model.ProcessingLogEntry;
import io.quarkus.security.Authenticated;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;
import org.jboss.logging.Logger;

import java.time.Instant;
import java.util.Map;

/**
 * OperatingWindowResource — admin configuration of the service window.
 *
 * Security strategy:
 *   - Class is @Authenticated (any logged-in user can reach it)
 *   - GET /status is accessible to all roles (INPUTTER, AUTHORISER, ADMIN)
 *   - GET / and POST / are restricted to ADMIN at the method level
 *
 * NOTE: class-level @RolesAllowed("ADMIN") was removed because in Quarkus,
 * the container evaluates the class-level restriction before method-level
 * overrides, which prevented INPUTTER/AUTHORISER from reaching /status.
 */
@Path("/api/v1/admin/operating-window")
@Tag(name = "Fenêtre de service", description = "Configuration des heures d'ouverture de l'application")
@Authenticated
@Produces(MediaType.APPLICATION_JSON)
public class OperatingWindowResource {

    private static final Logger LOG = Logger.getLogger(OperatingWindowResource.class);

    @Inject
    SecurityIdentity identity;

    /**
     * GET /api/v1/admin/operating-window/status
     * Accessible to every authenticated role — used by the sidebar badge.
     */
    @GET
    @Path("/status")
    @RolesAllowed({"ADMIN", "INPUTTER", "AUTHORISER"})
    @Operation(summary = "Statut d'ouverture de la fenêtre de service")
    public Response getStatus() {
        OperatingWindow w = OperatingWindow.get();
        if (w == null) return Response.ok(Map.of(
                "openNow", true, "openHour", 0, "closeHour", 23,
                "enabled", false, "adminKeepOpen", false)).build();
        return Response.ok(Map.of(
                "openNow", w.isOpenNow(),
                "openHour", w.openHour,
                "closeHour", w.closeHour,
                "enabled", w.enabled,
                "adminKeepOpen", w.adminKeepOpen
        )).build();
    }

    @GET
    @RolesAllowed("ADMIN")
    @Operation(summary = "Lire la configuration de la fenêtre de service")
    public Response getWindow() {
        OperatingWindow w = OperatingWindow.get();
        if (w == null) {
            // No document yet — return a safe default so the admin UI doesn't break
            return Response.ok(Map.of(
                    "enabled", false,
                    "openHour", 8,
                    "closeHour", 18,
                    "adminKeepOpen", false,
                    "openNow", true,
                    "zone", ""
            )).build();
        }
        return Response.ok(toDto(w)).build();
    }

    @POST
    @RolesAllowed("ADMIN")
    @Consumes(MediaType.APPLICATION_JSON)
    @Operation(summary = "Mettre à jour la fenêtre de service")
    public Response updateWindow(WindowUpdateRequest req) {
        if (req == null) {
            return Response.status(400).entity(Map.of("message", "Corps de requête manquant")).build();
        }

        OperatingWindow w = OperatingWindow.get();

        if (req.enabled() != null) w.enabled = req.enabled();
        if (req.openHour() != null) w.openHour = req.openHour();
        if (req.closeHour() != null) w.closeHour = req.closeHour();
        if (req.adminKeepOpen() != null) w.adminKeepOpen = req.adminKeepOpen();
        if (req.zone() != null && !req.zone().isBlank()) w.zone = req.zone().trim();

        if (!w.isValid()) {
            return Response.status(400).entity(Map.of(
                    "message", "Heures invalides : les valeurs doivent être comprises entre 0 et 23")).build();
        }

        String actor = identity.getPrincipal().getName();
        w.updatedBy = actor;
        w.lastUpdated = Instant.now();
        w.update();

        ProcessingLogEntry.log("INFO", String.format(
                "Fenêtre de service mise à jour par %s : %s, %02dh00–%02dh00, maintien ouvert=%s",
                actor, w.enabled ? "activée" : "désactivée", w.openHour, w.closeHour, w.adminKeepOpen));
        LOG.infof("Operating window updated by %s", actor);
        AdminAuditLog.record(actor, AdminAuditLog.WINDOW_UPDATED, "operating-window",
                "Fenêtre de service mise à jour : " +
                        (w.enabled ? "activée" : "désactivée") +
                        " (" + w.openHour + "h–" + w.closeHour + "h)",
                Map.of("enabled", w.enabled,
                        "openHour", w.openHour, "closeHour", w.closeHour,
                        "zone", String.valueOf(w.zone),
                        "adminKeepOpen", w.adminKeepOpen));

        return Response.ok(toDto(w)).build();
    }

    private Map<String, Object> toDto(OperatingWindow w) {
        return Map.of(
                "enabled", w.enabled,
                "openHour", w.openHour,
                "closeHour", w.closeHour,
                "zone", w.zone,
                "adminKeepOpen", w.adminKeepOpen,
                "openNow", w.isOpenNow(),
                "updatedBy", w.updatedBy == null ? "" : w.updatedBy,
                "lastUpdated", w.lastUpdated == null ? "" : w.lastUpdated.toString()
        );
    }

    public record WindowUpdateRequest(
            @JsonProperty("enabled") Boolean enabled,
            @JsonProperty("openHour") Integer openHour,
            @JsonProperty("closeHour") Integer closeHour,
            @JsonProperty("adminKeepOpen") Boolean adminKeepOpen,
            @JsonProperty("zone") String zone
    ) {
        @JsonCreator
        public WindowUpdateRequest {
        }
    }
}
