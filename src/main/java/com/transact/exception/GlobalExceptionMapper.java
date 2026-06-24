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

    @Override
    public Response toResponse(Exception e) {
        String path = uriInfo != null ? uriInfo.getPath() : "unknown";

        if (e instanceof WebApplicationException wae) {
            Response original = wae.getResponse();
            int status = original.getStatus();

            // If the endpoint already returned an ApiError body, pass it through unchanged
            if (original.hasEntity() && original.getEntity() instanceof ApiError) {
                return original;
            }

            // Prefer the message from the exception over the generic HTTP phrase
            String message = e.getMessage() != null ? e.getMessage() : ApiError.codeFor(status);

            return Response.status(status)
                    .type(MediaType.APPLICATION_JSON)
                    .entity(ApiError.of(ApiError.codeFor(status), message, path))
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
