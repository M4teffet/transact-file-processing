package com.transact;

import com.transact.processor.model.AppFeatureConfig;
import jakarta.annotation.security.RolesAllowed;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

import java.time.Instant;
import java.util.List;

/**
 * Admin endpoint for runtime feature toggles.
 * <p>
 * Fix: the original used a nested static class with @Path("/api/v1/admin/features")
 * on the inner class while the outer class had @Path("/api/v1"). JAX-RS concatenates
 * these, giving /api/v1/api/v1/admin/features — a 404 for every admin.js feature call.
 * Flattened to a single class with the correct absolute path.
 */
@Path("/api/v1/admin/features")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class SchedulerResource {

    @POST
    @RolesAllowed("ADMIN")
    @Path("/toggle/{key}")
    public Response toggleFeature(@PathParam("key") String key,
                                  @QueryParam("enabled") boolean enabled) {
        AppFeatureConfig config = AppFeatureConfig.find("configKey", key).firstResult();
        if (config == null) {
            config = new AppFeatureConfig();
            config.configKey = key;
            config.description = "Management for " + key;
        }
        config.isEnabled = enabled;
        config.lastUpdated = Instant.now();
        config.persistOrUpdate();
        return Response.ok(config).build();
    }

    @GET
    @RolesAllowed("ADMIN")
    public List<AppFeatureConfig> getAllFeatures() {
        return AppFeatureConfig.listAll();
    }
}
