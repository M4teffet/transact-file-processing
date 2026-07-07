package com.transact.exception;

import com.transact.dto.ApiError;
import io.quarkus.logging.Log;
import jakarta.ws.rs.WebApplicationException;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriInfo;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;

/**
 * Converts every unhandled exception into a standardised ApiError JSON body.
 * <p>
 * Before this mapper, endpoints returned a mix of:
 * Map.of("message", "...") — partial info, no error code
 * WebApplicationException — raw JAX-RS body with no JSON
 * 500 — plain HTML from the container
 * <p>
 * After this mapper, every non-2xx response has the shape:
 * { "error": "NOT_FOUND", "message": "...", "details": [], "timestamp": "...", "path": "..." }
 */
@Provider
public class GlobalExceptionMapper implements ExceptionMapper<Exception> {

    @Context
    UriInfo uriInfo;

    /**
     * User-facing French message for framework-level HTTP errors.
     */
    private static String friendlyMessage(int status) {
        return switch (status) {
            case 400 -> "Requête invalide.";
            case 401 -> "Identifiants invalides.";
            case 403 -> "Accès refusé.";
            case 404 -> "Ressource introuvable.";
            case 405 -> "Action non autorisée.";
            case 406, 415 -> "Requête invalide. Réessayez.";
            case 409 -> "Conflit avec l'état actuel.";
            case 429 -> "Trop de tentatives. Réessayez plus tard.";
            default -> "Une erreur est survenue. Réessayez.";
        };
    }

    @Override
    public Response toResponse(Exception e) {
        String path = uriInfo != null ? uriInfo.getPath() : "unknown";

        // ── TEMPORARY DIAGNOSTIC ─────────────────────────────────────────────
        // Logs the exact exception reaching this mapper. Check the server console
        // when reproducing the wrong-password case: it will show the real type,
        // status and message. Remove this block once the cause is confirmed.
        int diagStatus = (e instanceof WebApplicationException w) ? w.getResponse().getStatus() : -1;
        Log.errorf("[DIAG] mapper hit on path=%s  exType=%s  status=%d  msg=%s",
                path, e.getClass().getName(), diagStatus, e.getMessage());
        // ─────────────────────────────────────────────────────────────────────

        if (e instanceof WebApplicationException wae) {
            Response original = wae.getResponse();
            int status = original.getStatus();

            // If the endpoint already returned a structured body (ApiError or a
            // Map with a "message"), it's a deliberate business response — pass
            // it through unchanged so its user-facing message is preserved.
            if (original.hasEntity()) {
                Object entity = original.getEntity();
                if (entity instanceof ApiError) {
                    return original;
                }
                if (entity instanceof java.util.Map<?, ?> m && m.containsKey("message")) {
                    return Response.status(status)
                            .type(MediaType.APPLICATION_JSON)
                            .entity(ApiError.of(
                                    m.containsKey("code") ? String.valueOf(m.get("code")) : ApiError.codeFor(status),
                                    String.valueOf(m.get("message")), path))
                            .build();
                }
            }

            // Otherwise this is a FRAMEWORK-generated exception (e.g. 406 Not
            // Acceptable, 415 Unsupported Media Type, 404). Never surface its raw
            // technical message ("The accept header value did not match…") to the
            // user — use a clean French message keyed off the status.
            return Response.status(status)
                    .type(MediaType.APPLICATION_JSON)
                    .entity(ApiError.of(ApiError.codeFor(status), friendlyMessage(status), path))
                    .build();
        }

        // Truly unexpected error — log it and return 500
        Log.errorf(e, "Exception non gérée sur %s", path);
        return Response.status(500)
                .type(MediaType.APPLICATION_JSON)
                .entity(ApiError.of("INTERNAL_ERROR",
                        "Une erreur interne est survenue — contactez l'administrateur", path))
                .build();
    }
}
