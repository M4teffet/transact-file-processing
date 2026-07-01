package com.transact;

import com.transact.exception.ValidationError;
import com.transact.exception.ValidationException;
import com.transact.processor.model.Application;
import com.transact.processor.model.BatchData;
import com.transact.processor.model.FileBatch;
import com.transact.service.ApplicationService;
import com.transact.service.FileParser;
import com.transact.service.FileValidator;
import com.transact.service.GridFsService;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.SecurityContext;
import org.bson.types.ObjectId;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.jwt.JsonWebToken;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;
import org.jboss.resteasy.reactive.RestForm;
import org.jboss.resteasy.reactive.multipart.FileUpload;

import java.io.InputStream;
import java.nio.file.Files;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;


@Path("/api/v1/inputter")
@Tag(name = "File Upload", description = "Upload and validate CSV files")
@RolesAllowed("INPUTTER")
public class UploadResource {

    @ConfigProperty(name = "com.transact.upload.max-lines", defaultValue = "1000")
    int maxLines;

    @Inject
    GridFsService gridFsService;

    @Inject
    FileParser fileParser;

    @Inject
    FileValidator fileValidator;

    @Inject
    ApplicationService applicationService;

    @Inject
    com.transact.service.IdempotencyService idempotency;

    // Inject components to access the authenticated user identity
    @Inject
    JsonWebToken jwt;

    @Context
    SecurityContext securityContext;

    @POST
    @RolesAllowed("INPUTTER")
    @Path("/upload")
    @Produces(MediaType.APPLICATION_JSON)
    @org.eclipse.microprofile.openapi.annotations.Operation(
            summary = "Upload d'un fichier CSV",
            description = "Crée un nouveau lot. L'en-tête Idempotency-Key évite les doublons sur double-clic.")
    public Response uploadFile(
            @HeaderParam("Idempotency-Key") String idempotencyKey,
            @RestForm("applicationName") String applicationName,
            @RestForm("file") FileUpload fileUpload
    ) {
        // Replay if this exact upload was already accepted
        Response cached = idempotency.checkAndReturn(idempotencyKey);
        if (cached != null) return cached;

        // 1. Validate Inputs
        if (applicationName == null || applicationName.isBlank()) return badRequest("applicationName is required");
        if (fileUpload == null || fileUpload.filePath() == null) return badRequest("File is required");

        String originalFilename = fileUpload.fileName();
        Application appConfig = Application.findByName(applicationName.trim());
        if (appConfig == null) return badRequest("Application not found: " + applicationName);

        // 2. Pre-flight duplicate check (before touching GridFS)
        if (FileBatch.findActiveDuplicate(appConfig.id, originalFilename) != null) {
            return badRequest("A version of '" + originalFilename + "' is already active or processed.");
        }

        String userId = securityContext.getUserPrincipal().getName();

        // 3. Store raw file in GridFS BEFORE any parsing.
        //    This guarantees the original bytes are always available regardless of
        //    what happens during validation or processing.
        ObjectId gridFsFileId;
        try (InputStream rawStream = Files.newInputStream(fileUpload.filePath())) {
            gridFsFileId = gridFsService.store(originalFilename, rawStream, userId);
        } catch (Exception e) {
            return serverError("Échec du stockage du fichier : " + e.getMessage());
        }

        // 4. Parse and validate from the now-safely-stored file
        try (InputStream parseStream = Files.newInputStream(fileUpload.filePath())) {
            List<Map<String, String>> rawData = fileParser.parseCsv(parseStream);

            if (rawData == null || rawData.isEmpty()) {
                throw new ValidationException(List.of(new ValidationError(1, null, "CSV file is empty")));
            }

            if (rawData.size() > maxLines) {
                // File is already stored — clean up to avoid orphaned GridFS entries
                gridFsService.delete(gridFsFileId);
                return Response.status(413)
                        .entity(new JsonObject()
                                .put("error", "Fichier trop volumineux")
                                .put("message", "Le fichier dépasse la limite de " + maxLines + " lignes.")
                                .encode())
                        .build();
            }

            List<Map<String, Object>> validatedData = fileValidator.validateAndConvert(rawData, appConfig);

            // 5. Create Batch record and persist ONCE — then save rows
            FileBatch batch = createSuccessBatch(appConfig, validatedData, gridFsFileId);
            batch.originalFilename = originalFilename;
            batch.status = FileBatch.STATUS_UPLOADED;

            // 6. Persist with duplicate guard
            try {
                batch.persist();
            } catch (com.mongodb.MongoWriteException e) {
                if (e.getError().getCode() == 11000) {
                    gridFsService.delete(gridFsFileId);
                    return badRequest("Duplicate file: '" + originalFilename + "' has already being uploaded.");
                }
                throw e;
            }

            // 7. Save row data now that batch has an id
            saveBatchData(batch, validatedData);

            return successResponse(batch, validatedData.size(), idempotencyKey);

        } catch (ValidationException e) {
            // Keep the GridFS file even on validation failure — it lets admins
            // inspect exactly what was submitted and why it was rejected.
            saveFailedBatch(appConfig, originalFilename, FileBatch.STATUS_VALIDATED_FAILED, e, gridFsFileId);
            return validationErrorResponse(e);
        } catch (Exception e) {
            saveFailedBatch(appConfig, originalFilename, FileBatch.STATUS_UPLOADED_FAILED, e, gridFsFileId);
            return serverError(e.getMessage());
        }
    }


    // ========================================
// GET /check-filename
// The full path is now /api/inputter/check-filename
// ========================================
    @GET
    @Path("/check-filename")
    @Produces(MediaType.APPLICATION_JSON)
    public Response checkFilename(@QueryParam("applicationName") String appName, @QueryParam("filename") String filename) {
        if (appName == null || appName.isBlank() || filename == null || filename.isBlank()) {
            return Response.status(400).entity("Missing parameters").build();
        }

        Application app = Application.findByName(appName.trim());
        if (app == null) return Response.status(404).entity("Application not found").build();

        // Use the helper we created in the model
        boolean exists = FileBatch.findActiveDuplicate(app.id, filename) != null;

        return Response.ok(new JsonObject().put("exists", exists).encode()).build();
    }


    // ========================================
    // HELPERS
    // ========================================
    private FileBatch createSuccessBatch(Application app, List<Map<String, Object>> validatedData, ObjectId gridFsFileId) {
        String userId = securityContext.getUserPrincipal().getName();

        FileBatch batch = new FileBatch();
        batch.applicationId = app.id;
        batch.uploadedById = userId;
        batch.uploadTimestamp = Instant.now();
        batch.status = FileBatch.STATUS_UPLOADED;
        batch.gridFsFileId = gridFsFileId;

        var report = new FileBatch.ValidationReport();
        report.errors = 0;
        report.warnings = 0;
        report.summary = "Validation successful. " + validatedData.size() + " records processed.";
        report.details = List.of();
        batch.validationReport = report;

        // NOTE: do NOT call persist() here — caller handles persistence
        // so they can catch the duplicate key error before writing BatchData
        saveBatchData(batch, validatedData);
        return batch;
    }

    private void saveBatchData(FileBatch batch, List<Map<String, Object>> validatedData) {
        ObjectId batchId = batch.id;
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

    private FileBatch createFailedBatch(Application app, Exception e, ObjectId gridFsFileId) {
        String userId = securityContext.getUserPrincipal().getName();

        FileBatch batch = new FileBatch();
        batch.applicationId = app.id;
        batch.uploadedById = userId;
        batch.uploadTimestamp = Instant.now();
        batch.status = FileBatch.STATUS_UPLOADED_FAILED;
        batch.gridFsFileId = gridFsFileId;

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
        return successResponse(batch, count, null);
    }

    private Response successResponse(FileBatch batch, int count, String idempotencyKey) {
        var json = new JsonObject()
                .put("batchId", batch.id.toHexString())
                .put("status", batch.status)
                .put("recordCount", count);
        String body = json.encode();
        if (idempotencyKey != null) idempotency.store(idempotencyKey, 200, body);
        return Response.ok(body).build();
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

    private void saveFailedBatch(Application app, String filename, String status, Exception e, ObjectId gridFsFileId) {
        FileBatch batch = createFailedBatch(app, e, gridFsFileId);
        batch.originalFilename = filename;
        batch.status = status;
        batch.persistOrUpdate();
    }
}