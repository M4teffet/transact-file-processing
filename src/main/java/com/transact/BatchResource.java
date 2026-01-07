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
            @QueryParam("inputter") String inputter,
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

        Sort sort = Sort.by("uploadTimestamp").descending();
        PanacheQuery<FileBatch> query = filter.isEmpty()
                ? FileBatch.findAll(sort)
                : FileBatch.find(filter.toString(), sort, params);

        List<FileBatch> batches = query.page(Page.of(validatedPage, validatedSize)).list();

        List<BatchViewDTO> result = batches.stream().map(batch -> {
            // Efficiency: Fetch counts from the Statistics collection
            BatchStatistics stats = BatchStatistics.findById(batch.id);
            return new BatchViewDTO(
                    batch.id.toHexString(),
                    getAppName(batch.applicationId),
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
        ObjectId bId = parseObjectId(id); // Helper handles 400 error for bad formats

        // 1. Fetch the main batch record
        FileBatch batch = FileBatch.findById(bId);
        if (batch == null) return Response.status(404).entity("Batch not found").build();

        // 2. Fetch associated data and results
        List<BatchData> rows = BatchData.findByBatchId(bId);
        List<RowResult> results = RowResult.find("batchId", bId).list();

        // 3. Get cached statistics
        BatchStatistics stats = BatchStatistics.findById(bId);

        // 4. Map results for O(1) lookup during merging
        Map<Integer, RowResult> resultMap = results.stream()
                .collect(Collectors.toMap(
                        r -> r.lineNumber,
                        r -> r,
                        (existing, replacement) -> existing // Handle potential duplicates safely
                ));

        // 5. Build the detailed list (Merging BatchData + RowResult)
        List<RowDetailDTO> details = rows.stream().map(row -> {
            RowResult res = resultMap.get(row.lineNumber);
            return new RowDetailDTO(
                    row.lineNumber,
                    row.data,
                    res != null ? res.status : "PENDING", // Status is PENDING if result doesn't exist yet
                    res != null ? res.t24Reference : null,
                    res != null ? res.errorMessage : null
            );
        }).collect(Collectors.toList());

        // 6. Construct and return the response
        return Response.ok(new BatchDetailResponse(
                batch.id.toHexString(),
                getAppName(batch.applicationId),
                batch.status,
                batch.uploadTimestamp,
                stats != null ? (int) stats.totalRecords : rows.size(), // Fallback to list size if stats missing
                details
        )).build();
    }


    // ========================================
    // PUT /batches/{id}
    // ========================================
    @PUT
    @Path("/{id}")
    @Consumes(MediaType.APPLICATION_JSON)
    @Operation(summary = "Validate batch", description = "Transition status from UPLOADED to VALIDATED")
    public Response updateBatchStatus(@PathParam("id") String id, BatchUpdateRequest request) {
        ObjectId batchId = parseObjectId(id);
        FileBatch batch = FileBatch.findById(batchId);

        if (batch == null) {
            return Response.status(404).entity("Batch not found").build();
        }

        // Validation Logic
        if (!FileBatch.STATUS_VALIDATED.equals(request.status())) {
            return Response.status(400).entity("Only 'VALIDATED' status transition is allowed via this endpoint").build();
        }

        if (!FileBatch.STATUS_UPLOADED.equals(batch.status)) {
            return Response.status(403).entity("Current status is " + batch.status + "; expected UPLOADED").build();
        }

        // Perform the update
        batch.status = FileBatch.STATUS_VALIDATED;
        batch.validatedById = identity.getPrincipal().getName();
        batch.validationTimestamp = Instant.now();

        // Calculate and cache statistics for the batch
        BatchStatistics stats = BatchStatistics.calculate(batchId);
        if (stats != null) {
            stats.persistOrUpdate();
        }

        batch.update();

        return Response.ok(Map.of(
                "message", "Batch validated successfully",
                "totalRecords", stats != null ? stats.totalRecords : 0
        )).build();
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

        // Restriction Check
        List<String> deletable = List.of(FileBatch.STATUS_UPLOADED, FileBatch.STATUS_UPLOADED_FAILED, FileBatch.STATUS_VALIDATED_FAILED);
        if (!deletable.contains(batch.status)) {
            return Response.status(403).entity("Cannot delete batch in status: " + batch.status).build();
        }

        // Atomic cleanup across collections
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

        List<RecentBatchDTO> list = FileBatch.<FileBatch>findAll(Sort.descending("uploadTimestamp"))
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

        if (batchId != null && !batchId.isBlank()) {
            ObjectId bId = parseObjectId(batchId);
            // Filter logs for a specific batch
            return ProcessingLogEntry.find("batchId", Sort.by("timestamp").descending(), bId)
                    .page(Page.of(0, 1000))
                    .list();
        } else {
            // Return latest global logs if no batchId is selected
            return ProcessingLogEntry.findAll(Sort.by("timestamp").descending())
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
    @Operation(summary = "Get batch status statistics", description = "Returns a map of status names to the count of batches in that status")
    public Map<String, Long> getBatchCounts() {
        Map<String, Long> counts = new HashMap<>();

        // Define the statuses we want to track based on FileBatch constants
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

        for (String status : statusesToTrack) {
            // Efficiently count batches per status using Panache
            counts.put(status, FileBatch.count("status", status));
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
    public record BatchViewDTO(String batchId, String application, String status, Instant uploadedAt, int totalRecords, int errorCount) {
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
            String status,
            Instant uploadedAt,
            int totalRecords,
            List<RowDetailDTO> details
    ) {
    }
}