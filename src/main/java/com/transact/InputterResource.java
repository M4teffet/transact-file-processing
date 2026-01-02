package com.transact;

import com.transact.exception.ValidationError;
import com.transact.exception.ValidationException;
import com.transact.processor.model.Application;
import com.transact.processor.model.BatchData;
import com.transact.processor.model.FileBatch;
import com.transact.service.ApplicationService;
import com.transact.service.FileParser;
import com.transact.service.FileValidator;
import io.quarkus.security.Authenticated;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.SecurityContext;
import org.bson.types.ObjectId;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.jwt.JsonWebToken;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.parameters.Parameter;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;
import org.jboss.resteasy.reactive.RestForm;
import org.jboss.resteasy.reactive.multipart.FileUpload;

import java.io.InputStream;
import java.nio.file.Files;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;


@Path("/api/inputter")
@Tag(name = "File Upload", description = "Upload and validate CSV files")
@RolesAllowed("INPUTTER") // 🔑 FIX: Enforce security validation for the entire resource
public class InputterResource {

    @ConfigProperty(name = "com.transact.upload.max-lines", defaultValue = "100")
    int maxLines;

    @Inject
    FileParser fileParser;

    @Inject
    FileValidator fileValidator;

    @Inject
    ApplicationService applicationService;

    // Inject components to access the authenticated user identity
    @Inject
    JsonWebToken jwt;

    @Context
    SecurityContext securityContext;


    // ========================================
    // POST /upload
    // The full path is now /api/inputter/upload
    // ========================================
    @POST
    @Authenticated
    @Path("/upload")
    @Consumes(MediaType.MULTIPART_FORM_DATA)
    @Produces(MediaType.APPLICATION_JSON)
    @Operation(summary = "Upload CSV file", description = "Validates CSV against application schema")
    public Response uploadFile(
            @RestForm("applicationName") @Parameter(required = true) String applicationName,
            @RestForm("file") @Parameter(required = true) FileUpload fileUpload
    ) {

        // 1. Initial Validation
        if (applicationName == null || applicationName.trim().isBlank()) {
            return badRequest("applicationName is required");
        }
        if (fileUpload == null || fileUpload.filePath() == null) {
            return badRequest("File is required");
        }

        Application appConfig = Application.findByName(applicationName.trim());
        if (appConfig == null) {
            return badRequest("Application not found: " + applicationName);
        }

        // 2. Stream directly from the file path
        // This prevents loading the entire file into the JVM heap at once
        try (InputStream inputStream = Files.newInputStream(fileUpload.filePath())) {

            // Ensure your fileParser.parseCsv can accept an InputStream
            List<Map<String, String>> rawData = fileParser.parseCsv(inputStream);

            if (rawData == null || rawData.isEmpty()) {
                throw new ValidationException(List.of(
                        new ValidationError(1, null, "CSV file is empty or contains only headers")
                ));
            }

            // 3. Size validation
            if (rawData.size() > maxLines) {
                return Response.status(Response.Status.BAD_REQUEST)
                        .entity(new JsonObject()
                                .put("error", "File too large")
                                .put("message", "Max lines: " + maxLines)
                                .encode())
                        .build();
            }

            // 4. Processing
            List<Map<String, Object>> validatedData = fileValidator.validateAndConvert(rawData, appConfig);
            FileBatch batch = createSuccessBatch(appConfig, validatedData);
            return successResponse(batch, validatedData.size());

        } catch (ValidationException e) {
            FileBatch batch = createFailedBatch(appConfig, e);
            batch.persist();
            return validationErrorResponse(e);
        } catch (Exception e) {
            FileBatch batch = createFailedBatch(appConfig, e);
            batch.persist();
            return serverError(e.getMessage());
        }
    }

    // ========================================
    // HELPERS
    // ========================================
    private FileBatch createSuccessBatch(Application app, List<Map<String, Object>> validatedData) {
        // Retrieve the authenticated user's ID (UPN/username from the JWT)
        String userId = securityContext.getUserPrincipal().getName();

        FileBatch batch = new FileBatch();
        batch.applicationId = app.id;
        batch.uploadedById = userId; // 🔑 FIX: Populate the user ID
        batch.uploadTimestamp = Instant.now();
        batch.status = FileBatch.STATUS_UPLOADED;

        var report = new FileBatch.ValidationReport();
        report.errors = 0;
        report.warnings = 0;
        report.summary = "Validation successful. " + validatedData.size() + " records processed.";
        report.details = List.of();
        batch.validationReport = report;

        batch.persist();
        saveBatchData(batch.id, validatedData);
        return batch;
    }

    private void saveBatchData(ObjectId batchId, List<Map<String, Object>> validatedData) {
        List<BatchData> records = new ArrayList<>();
        for (int i = 0; i < validatedData.size(); i++) {
            BatchData bd = new BatchData();
            bd.batchId = batchId;
            bd.lineNumber = i + 2;
            bd.data = validatedData.get(i);
            bd.createdAt = Instant.now();
            records.add(bd);
        }
        BatchData.persist(records);
    }

    private FileBatch createFailedBatch(Application app, Exception e) {
        // Retrieve the authenticated user's ID (UPN/username from the JWT)
        String userId = securityContext.getUserPrincipal().getName();

        FileBatch batch = new FileBatch();
        batch.applicationId = app.id;
        batch.uploadedById = userId; // 🔑 FIX: Populate the user ID
        batch.uploadTimestamp = Instant.now();
        batch.status = FileBatch.STATUS_UPLOADED_FAILED;

        var report = new FileBatch.ValidationReport();
        if (e instanceof ValidationException ve) {
            report.errors = ve.getErrors().size();
            report.summary = "Validation failed with " + report.errors + " error(s)";
            report.details = ve.getErrors();
        } else {
            report.errors = 1;
            report.summary = "Processing failed: " + e.getMessage();
            report.details = List.of();
        }
        batch.validationReport = report;
        return batch;
    }

    private Response successResponse(FileBatch batch, int count) {
        var json = new JsonObject()
                .put("batchId", batch.id.toHexString())
                .put("status", batch.status)
                .put("recordCount", count);
        return Response.ok(json.encode()).build();
    }

    private Response validationErrorResponse(ValidationException e) {
        var details = new JsonArray();
        for (var err : e.getErrors()) {
            details.add(new JsonObject()
                    .put("line", err.line())
                    .put("field", err.field())
                    .put("message", err.message()));
        }
        var error = new JsonObject()
                .put("error", "Validation failed")
                .put("details", details);
        return Response.status(400).entity(error.encode()).build();
    }

    private Response badRequest(String msg) {
        return Response.status(400).entity(msg).build();
    }

    private Response payloadTooLarge() {
        return Response.status(413).entity("File too large").build();
    }

    private Response serverError(String msg) {
        return Response.status(500).entity("Server error: " + msg).build();
    }
}