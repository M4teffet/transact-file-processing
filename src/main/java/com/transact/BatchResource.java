package com.transact;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.transact.processor.model.*;
import io.quarkus.mongodb.panache.PanacheQuery;
import io.quarkus.panache.common.Page;
import io.quarkus.panache.common.Sort;
import io.quarkus.security.Authenticated;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.inject.Inject;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.bson.types.ObjectId;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.media.Schema;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Path("/api/batches")
@Tag(name = "Batches", description = "Query batch uploads and data")
@Authenticated
public class BatchResource {

    @Inject
    SecurityIdentity identity;

    // --- GET /batches (List View) ---
    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public Response getBatches(
            @QueryParam("application") String application,
            @QueryParam("status") List<String> status,
            @QueryParam("uploadedById") String uploadedById,
            @QueryParam("from") String fromStr,
            @QueryParam("to") String toStr,
            @QueryParam("page") @DefaultValue("0") int page,
            @QueryParam("size") @DefaultValue("20") int size
    ) {
        int validatedPage = Math.max(page, 0);
        int validatedSize = Math.min(Math.max(size, 1), 100);

        StringBuilder filter = new StringBuilder();
        Map<String, Object> params = new HashMap<>();

        // Application Filter
        if (application != null && !application.isBlank()) {
            Application app = Application.findByName(application.trim());
            if (app == null) return emptyResponse(validatedPage, validatedSize);
            filter.append("applicationId = :appId");
            params.put("appId", app.id);
        }

        // Status Filter
        if (status != null && !status.isEmpty()) {
            if (!filter.isEmpty()) filter.append(" and ");
            filter.append("status IN :status");
            params.put("status", status);
        }

        // Inputter Filter
        if (uploadedById != null && !uploadedById.isBlank()) {
            if (!filter.isEmpty()) filter.append(" and ");
            filter.append("uploadedById = :uploadedById");
            params.put("uploadedById", uploadedById.trim());
        }

        // Country Filter
        String currentUsername = identity.getPrincipal().getName();

        System.out.println("currentUsername = " + currentUsername);
        AppUser currentUser = AppUser.findByUsername(currentUsername).orElse(null);

        System.out.println("currentUser = " + currentUser.countryCode);
        if (currentUser == null) {
            throw new WebApplicationException("User not found", 403);
        }


        String currentCountry = currentUser.countryCode;
        Integer currentDepartmentId = currentUser.department;

        List<String> sameCountryUploaders =
                AppUser.<AppUser>find(
                                "countryCode = ?1 and departmentId = ?2",
                                currentCountry,
                                currentDepartmentId
                        )
                        .list()
                        .stream()
                        .map(AppUser::getUsername)
                        .collect(Collectors.toList());

        if (!filter.isEmpty()) filter.append(" and ");
        filter.append("uploadedById IN :sameCountryUploaders");
        params.put("sameCountryUploaders", sameCountryUploaders);

        Sort sort = Sort.by("uploadTimestamp").descending();
        PanacheQuery<FileBatch> query = filter.isEmpty()
                ? FileBatch.findAll(sort)
                : FileBatch.find(filter.toString(), sort, params);

        List<FileBatch> batches = query.page(Page.of(validatedPage, validatedSize)).list();

        List<BatchViewDTO> result = batches.stream().map(batch -> {
            BatchStatistics stats = BatchStatistics.findById(batch.id);
            return new BatchViewDTO(
                    batch.id.toHexString(),
                    getAppName(batch.applicationId),
                    batch.originalFilename,
                    batch.status,
                    batch.uploadTimestamp,
                    stats != null ? (int) stats.totalRecords : 0,
                    batch.validationReport != null ? batch.validationReport.errors : 0
            );
        }).collect(Collectors.toList());

        return Response.ok(new BatchPageResponse(result, validatedPage, validatedSize, query.count(), query.pageCount())).build();
    }

    // ========================================
    // GET /batches/{id}
    // ========================================
    @GET
    @Authenticated
    @Path("/{id}")
    @Produces(MediaType.APPLICATION_JSON)
    @Operation(summary = "Get detailed batch info", description = "Combines metadata, raw data, and processing results")
    public Response getBatchById(@PathParam("id") String id) {
        ObjectId bId = parseObjectId(id);

        FileBatch batch = FileBatch.findById(bId);
        if (batch == null) return Response.status(404).entity("Batch not found").build();

        // Country Access Check
        String currentUsername = identity.getPrincipal().getName();
        AppUser currentUser = AppUser.findByUsername(currentUsername).orElse(null);
        if (currentUser == null) {
            return Response.status(403).entity("User not found").build();
        }
        String currentCountry = currentUser.countryCode;
        AppUser uploader = AppUser.findByUsername(batch.uploadedById).orElse(null);
        if (uploader == null || !currentCountry.equals(uploader.countryCode)) {
            return Response.status(403).entity("Access Denied: Batch from different country").build();
        }

        List<BatchData> rows = BatchData.findByBatchId(bId);
        List<RowResult> results = RowResult.find("batchId", bId).list();

        BatchStatistics stats = BatchStatistics.findById(bId);

        Map<Integer, RowResult> resultMap = results.stream()
                .collect(Collectors.toMap(r -> r.lineNumber, r -> r));

        List<RowDetailDTO> details = rows.stream().map(row -> {
            RowResult res = resultMap.get(row.lineNumber);
            return new RowDetailDTO(
                    row.lineNumber,
                    row.data,
                    res != null ? res.status : "PENDING",
                    res != null ? res.t24Reference : null,
                    res != null ? res.errorMessage : null
            );
        }).collect(Collectors.toList());

        return Response.ok(new BatchDetailResponse(
                batch.id.toHexString(),
                getAppName(batch.applicationId),
                batch.originalFilename,
                batch.status,
                batch.uploadTimestamp,
                stats != null ? (int) stats.totalRecords : rows.size(),
                details
        )).build();
    }

    // ========================================
    // PUT /batches/{id}
    // ========================================
    @PUT
    @Path("/{id}")
    @Consumes(MediaType.APPLICATION_JSON)
    public Response updateBatchStatus(@PathParam("id") String id, BatchUpdateRequest request) {
        ObjectId batchId = parseObjectId(id);
        FileBatch batch = FileBatch.findById(batchId);

        if (batch == null) {
            return Response.status(404).entity("Batch not found").build();
        }

        String validatorName = identity.getPrincipal().getName();
        AppUser validator = AppUser.findByUsername(validatorName).orElse(null);

        String inputterName = batch.uploadedById;
        AppUser inputter = AppUser.findByUsername(inputterName).orElse(null);

        if (validator == null || inputter == null) {
            return Response.status(403).entity("User context missing").build();
        }

        if (!validator.countryCode.equals(inputter.countryCode)) {
            return Response.status(403)
                    .entity("Permission Denied: You (" + validator.countryCode + ") cannot validate a batch from " + inputter.countryCode).build();
        }

        if (!FileBatch.STATUS_VALIDATED.equals(request.status())) {
            return Response.status(400).entity("Invalid status transition").build();
        }

        if (!FileBatch.STATUS_UPLOADED.equals(batch.status)) {
            return Response.status(403).entity("Batch is not in UPLOADED state").build();
        }

        batch.status = FileBatch.STATUS_VALIDATED;
        batch.validatedById = validatorName;
        batch.validationTimestamp = Instant.now();

        BatchStatistics stats = BatchStatistics.calculate(batchId);
        if (stats != null) stats.persistOrUpdate();
        batch.update();

        return Response.ok(Map.of("message", "Batch validated successfully")).build();
    }

    // ========================================
    // DELETE /batches/{id}
    // ========================================
    @DELETE
    @Path("/{id}")
    public Response deleteBatchById(@PathParam("id") String id) {
        ObjectId batchId = parseObjectId(id);
        FileBatch batch = FileBatch.findById(batchId);
        if (batch == null) return Response.status(404).build();

        // Country Access Check
        String currentUsername = identity.getPrincipal().getName();
        AppUser currentUser = AppUser.findByUsername(currentUsername).orElse(null);
        if (currentUser == null) {
            return Response.status(403).entity("User not found").build();
        }
        String currentCountry = currentUser.countryCode;
        AppUser uploader = AppUser.findByUsername(batch.uploadedById).orElse(null);
        if (uploader == null || !currentCountry.equals(uploader.countryCode)) {
            return Response.status(403).entity("Access Denied: Batch from different country").build();
        }

        List<String> deletable = List.of(FileBatch.STATUS_UPLOADED, FileBatch.STATUS_UPLOADED_FAILED, FileBatch.STATUS_VALIDATED_FAILED);
        if (!deletable.contains(batch.status)) {
            return Response.status(403).entity("Cannot delete batch in status: " + batch.status).build();
        }

        BatchData.delete("batchId", batchId);
        RowResult.delete("batchId", batchId);
        BatchStatistics.deleteById(batchId);
        batch.delete();

        return Response.noContent().build();
    }

    // ========================================
    // GET /recent-batches
    // ========================================
    @GET
    @Path("/recent-batches")
    @Produces(MediaType.APPLICATION_JSON)
    public Response getRecentBatches() {

        String currentUsername = identity.getPrincipal().getName();
        AppUser currentUser = AppUser.findByUsername(currentUsername).orElse(null);
        if (currentUser == null) {
            return Response.ok(List.of()).build();
        }
        String currentCountry = currentUser.countryCode;
        List<String> sameCountryUploaders =
                AppUser.<AppUser>find("countryCode", currentCountry)
                        .list()
                        .stream()
                        .map(AppUser::getUsername)
                        .collect(Collectors.toList());

        List<RecentBatchDTO> list = FileBatch.<FileBatch>find("uploadedById IN ?1", Sort.descending("uploadTimestamp"), sameCountryUploaders)
                .page(Page.of(0, 10))
                .stream()
                .map(batch -> new RecentBatchDTO(
                        batch.id.toHexString(),
                        batch.status,
                        batch.uploadTimestamp
                ))
                .collect(Collectors.toList());

        return Response.ok(list).build();
    }

    // ========================================
    // GET /api/batches/processing-logs
    // ========================================
    @GET
    @Path("/processing-logs")
    @Produces(MediaType.APPLICATION_JSON)
    @Operation(summary = "Get logs, filtered by batchId if provided")
    public List<ProcessingLogEntry> getProcessingLogs(
            @QueryParam("batchId") String batchId) {

        String currentUsername = identity.getPrincipal().getName();
        AppUser currentUser = AppUser.findByUsername(currentUsername).orElse(null);
        if (currentUser == null) {
            return List.of();
        }
        String currentCountry = currentUser.countryCode;

        if (batchId != null && !batchId.isBlank()) {
            ObjectId bId = parseObjectId(batchId);
            FileBatch batch = FileBatch.findById(bId);
            if (batch == null) return List.of();
            AppUser uploader = AppUser.findByUsername(batch.uploadedById).orElse(null);
            if (uploader == null || !currentCountry.equals(uploader.countryCode)) {
                return List.of();
            }
            return ProcessingLogEntry.find("batchId", Sort.by("timestamp").descending(), bId)
                    .page(Page.of(0, 1000))
                    .list();
        } else {
            List<String> sameCountryUploaders =
                    AppUser.<AppUser>find("countryCode", currentCountry)
                            .list()
                            .stream()
                            .map(AppUser::getUsername)
                            .collect(Collectors.toList());

            List<FileBatch> allowedBatches = FileBatch.find("uploadedById IN ?1", sameCountryUploaders).list();
            List<ObjectId> allowedBatchIds = allowedBatches.stream()
                    .map(batch -> batch.id)
                    .collect(Collectors.toList());
            return ProcessingLogEntry.find("batchId IN ?1", Sort.by("timestamp").descending(), allowedBatchIds)
                    .page(Page.of(0, 100))
                    .list();
        }
    }

    // ========================================
    // GET /count
    // ========================================
    @GET
    @Path("/counts")
    @Produces(MediaType.APPLICATION_JSON)
    @Operation(
            summary = "Get batch status statistics",
            description = "Returns a map of status names to the count of batches in that status, optionally filtered by inputter"
    )
    public Map<String, Long> getBatchCounts(
            @QueryParam("uploadedById") String inputter
    ) {
        Map<String, Long> counts = new HashMap<>();

        String currentUsername = identity.getPrincipal().getName();
        AppUser currentUser = AppUser.findByUsername(currentUsername).orElse(null);
        if (currentUser == null) {
            return counts;
        }
        String currentCountry = currentUser.countryCode;
        List<String> sameCountryUploaders =
                AppUser.<AppUser>find("countryCode", currentCountry)
                        .list()
                        .stream()
                        .map(AppUser::getUsername)
                        .collect(Collectors.toList());


        List<String> statusesToTrack = List.of(
                FileBatch.STATUS_UPLOADED,
                FileBatch.STATUS_UPLOADED_FAILED,
                FileBatch.STATUS_VALIDATED,
                FileBatch.STATUS_VALIDATED_FAILED,
                FileBatch.STATUS_PROCESSING,
                FileBatch.STATUS_PROCESSED,
                FileBatch.STATUS_PROCESSED_FAILED,
                FileBatch.STATUS_PROCESSED_PARTIAL
        );
        boolean filterByInputter = inputter != null && !inputter.isBlank();

        for (String status : statusesToTrack) {
            long count;
            if (filterByInputter) {
                AppUser specificInputter = AppUser.findByUsername(inputter).orElse(null);
                if (specificInputter == null || !currentCountry.equals(specificInputter.countryCode)) {
                    count = 0;
                } else {
                    count = FileBatch.count("status = ?1 and uploadedById = ?2", status, inputter);
                }
            } else {
                count = FileBatch.count("status = ?1 and uploadedById IN ?2", status, sameCountryUploaders);
            }
            counts.put(status, count);
        }
        return counts;
    }

    // ========================================
    // --- Helpers ---
    // ========================================
    private ObjectId parseObjectId(String id) {
        try {
            return new ObjectId(id);
        } catch (IllegalArgumentException e) {
            throw new WebApplicationException("Invalid ID format", 400);
        }
    }

    private String getAppName(ObjectId appId) {
        if (appId == null) return "Unknown";
        Application app = Application.findById(appId);
        return app != null ? app.name : "Unknown";
    }

    private Response emptyResponse(int page, int size) {
        return Response.ok(new BatchPageResponse(List.of(), page, size, 0, 0)).build();
    }

    // ========================================
    // --- DTOs ---
    // ========================================
    public record BatchViewDTO(String batchId, String application, String originalFilename, String status, Instant uploadedAt,
                               int totalRecords, int errorCount) {
    }

    public record BatchPageResponse(List<BatchViewDTO> content, int page, int size, long totalElements, long totalPages) {
    }

    public record BatchUpdateRequest(String status) {
        @JsonCreator
        public BatchUpdateRequest(@JsonProperty("status") String status) {
            this.status = status;
        }
    }

    @Schema(name = "RowDetailDTO")
    public record RowDetailDTO(
            int lineNumber,
            Map<String, Object> data,
            String status, // SUCCESS | FAILED | PENDING
            String t24Reference,
            String errorMessage
    ) {
    }

    @Schema(name = "RecentBatchDTO")
    public record RecentBatchDTO(
            String id,
            String status,
            Instant uploadedAt
    ) {
    }

    @Schema(name = "BatchDetailResponse")
    public record BatchDetailResponse(
            String batchId,
            String application,
            String originalFilename,
            String status,
            Instant uploadedAt,
            int totalRecords,
            List<RowDetailDTO> details
    ) {
    }
}