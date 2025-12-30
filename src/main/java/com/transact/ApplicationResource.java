package com.transact;

import com.transact.processor.model.Application;
import com.transact.service.ApplicationService;
import io.quarkus.security.Authenticated;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

import java.util.List;
import java.util.stream.Collectors;


@Path("/api/applications")

@Tag(name = "Applications", description = "Manage application configurations")
public class ApplicationResource {

    @Inject
    ApplicationService applicationService;

    // ========================================
    // GET /applications
    // ========================================

    @GET
    @Authenticated
    @Produces(MediaType.APPLICATION_JSON)
    public List<ApplicationDto> getApplications() {
        // Fetch from MongoDB using entity's static method - map to DTO for API response
        return Application.findAllApps().stream()
                .map(app -> new ApplicationDto(app.name, app.description))
                .collect(Collectors.toList());
    }


    // ========================================
    // GET /applications/{appName}/fields
    // ========================================
    @GET
    @Authenticated
    @Path("/{appName}/fields")
    @Produces(MediaType.APPLICATION_JSON)
    public Response getApplicationFieldInfo(@PathParam("appName") String appName) {
        Application app = Application.findByName(appName);
        if (app == null) {
            return Response.status(404).entity("Application not found").build();
        }

        var response = applicationService.getApplicationFields(app);
        return Response.ok(response).build();
    }

    // DTO for JSON serialization (keeps entity separate from API, excludes schema for this endpoint)
    public record ApplicationDto(String code, String label) {
    }
}