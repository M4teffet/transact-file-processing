package com.transact;

import com.transact.processor.model.AdminAuditLog;
import io.quarkus.mongodb.panache.PanacheQuery;
import io.quarkus.panache.common.Sort;
import jakarta.annotation.security.RolesAllowed;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;

/**
 * Read-only audit trail for ADMIN users.
 * <p>
 * GET /api/v1/admin/audit          — paginated, filterable log
 * GET /api/v1/admin/audit/actions  — distinct action types for filter dropdowns
 */
@Path("/api/v1/admin/audit")
@Produces(MediaType.APPLICATION_JSON)
@RolesAllowed("ADMIN")
@Tag(name = "Audit Trail")
public class AuditResource {

    private static final int DEFAULT_SIZE = 25;
    private static final int MAX_SIZE = 100;

    @GET
    @Operation(summary = "Journal d'audit paginé")
    public Response getAuditLog(
            @QueryParam("page") @DefaultValue("0") int page,
            @QueryParam("size") @DefaultValue("25") int size,
            @QueryParam("action") String action,
            @QueryParam("performedBy") String performedBy,
            @QueryParam("target") String target,
            @QueryParam("from") String from,
            @QueryParam("to") String to
    ) {
        int validSize = Math.min(Math.max(size, 1), MAX_SIZE);
        int validPage = Math.max(page, 0);

        // Build dynamic query string
        StringBuilder qs = new StringBuilder();
        List<Object> params = new java.util.ArrayList<>();

        if (action != null && !action.isBlank()) {
            append(qs, "action = ?1");
            params.add(action.trim());
        }
        if (performedBy != null && !performedBy.isBlank()) {
            append(qs, "performedBy = ?" + (params.size() + 1));
            params.add(performedBy.trim());
        }
        if (target != null && !target.isBlank()) {
            append(qs, "target like ?"); // Panache doesn't support $regex easily — prefix match
            // Fall back to simple contains filter post-query for target
        }
        if (from != null && !from.isBlank()) {
            Instant fromInstant = LocalDate.parse(from).atStartOfDay(ZoneOffset.UTC).toInstant();
            append(qs, "timestamp >= ?" + (params.size() + 1));
            params.add(fromInstant);
        }
        if (to != null && !to.isBlank()) {
            Instant toInstant = LocalDate.parse(to).atTime(23, 59, 59).atOffset(ZoneOffset.UTC).toInstant();
            append(qs, "timestamp <= ?" + (params.size() + 1));
            params.add(toInstant);
        }

        try {
            PanacheQuery<AdminAuditLog> query;
            if (qs.isEmpty()) {
                query = AdminAuditLog.findAll(Sort.by("timestamp", Sort.Direction.Descending));
            } else {
                query = AdminAuditLog.find(qs.toString(), Sort.by("timestamp", Sort.Direction.Descending),
                        params.toArray());
            }

            List<AdminAuditLog> items = query.page(validPage, validSize).list();

            // Post-filter by target contains (case-insensitive)
            if (target != null && !target.isBlank()) {
                String tl = target.toLowerCase();
                items = items.stream()
                        .filter(e -> e.target != null && e.target.toLowerCase().contains(tl))
                        .toList();
            }

            return Response.ok(Map.of(
                    "items", items,
                    "page", validPage,
                    "size", validSize,
                    "total", query.count(),
                    "totalPages", (int) Math.ceil((double) query.count() / validSize)
            )).build();

        } catch (Exception e) {
            return Response.status(500)
                    .entity(Map.of("message", "Erreur lors de la lecture du journal : " + e.getMessage()))
                    .build();
        }
    }

    @GET
    @Path("/actions")
    @Operation(summary = "Liste des types d'action distincts pour les filtres")
    public Response getDistinctActions() {
        // Hardcoded constants from AdminAuditLog for type safety
        List<String> actions = List.of(
                AdminAuditLog.USER_CREATED,
                "USER_UPDATED",
                "USER_DELETED",
                "USER_LOCKED",
                "USER_UNLOCKED",
                "PASSWORD_CHANGED",
                "PASSWORD_RESET",
                AdminAuditLog.BATCH_VALIDATED,
                AdminAuditLog.BATCH_DELETED,
                "POLICY_UPDATED",
                "OPERATING_WINDOW_UPDATED",
                "FEATURE_TOGGLED",
                "SESSION_POLICY_UPDATED"
        );
        return Response.ok(actions).build();
    }

    private void append(StringBuilder sb, String clause) {
        if (!sb.isEmpty()) sb.append(" and ");
        sb.append(clause);
    }
}
