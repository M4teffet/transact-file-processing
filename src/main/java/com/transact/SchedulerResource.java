package com.transact;

import com.transact.processor.model.AppFeatureConfig;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

import java.time.Instant;
import java.util.List;


@Path("/api")
public class SchedulerResource {

    @Path("/api/admin/features")
    @Produces(MediaType.APPLICATION_JSON)
    @Consumes(MediaType.APPLICATION_JSON)

    public static class FeatureToggleResource {

        @POST
        @Path("/toggle/{key}")
        public Response toggleFeature(@PathParam("key") String key, @QueryParam("enabled") boolean enabled) {
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
        public List<AppFeatureConfig> getAllFeatures() {
            return AppFeatureConfig.listAll();
        }
    }
}
