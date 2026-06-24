package com.transact;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.transact.dto.ApiError;
import com.transact.processor.model.*;
import com.transact.service.GridFsService;
import com.transact.service.IdempotencyService;
import io.quarkus.cache.Cache;
import io.quarkus.cache.CacheName;
import io.quarkus.logging.Log;
import io.quarkus.mongodb.panache.PanacheQuery;
import io.quarkus.panache.common.Page;
import io.quarkus.panache.common.Sort;
import io.quarkus.security.Authenticated;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.bson.types.ObjectId;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.media.Schema;
import org.eclipse.microprofile.openapi.annotations.parameters.Parameter;
import org.eclipse.microprofile.openapi.annotations.responses.APIResponse;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;
import org.jboss.logging.Logger;

import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

/**
 * BatchResource - VERSION FRANÇAISE
 * <p>
 * ✅ Tous les messages et logs en français
 * ✅ Messages d'erreur en français
 * ✅ Logs système en français
 * ✅ Optimisé avec Cache Quarkus et Agrégation MongoDB
 */
@Path("/api/v1/batches")
@Tag(name = "Lots", description = "Consultation des lots de fichiers uploadés")
@Authenticated
public class BatchResource {

    private static final Logger LOG = Logger.getLogger(BatchResource.class);

    @Inject
    SecurityIdentity identity;

    @Inject
    GridFsService gridFsService;

    @Inject
    IdempotencyService idempotency;

    @Inject
    ObjectMapper objectMapper;

    private static final Set<String> VALID_STATUSES = Set.of(
            FileBatch.STATUS_UPLOADED,
            FileBatch.STATUS_UPLOADED_FAILED,
            FileBatch.STATUS_VALIDATED,
            FileBatch.STATUS_VALIDATED_FAILED,
            FileBatch.STATUS_PROCESSING,
            FileBatch.STATUS_PROCESSED,
            FileBatch.STATUS_PROCESSED_FAILED,
            FileBatch.STATUS_PROCESSED_PARTIAL
    );

    @Inject
    @CacheName("applications")
    Cache applicationCache;

    @Inject
    @CacheName("user-country-cache")
    Cache userCountryCache;

    @ConfigProperty(name = "app.pagination.max-size", defaultValue = "50")
    int maxPageSize;

    @ConfigProperty(name = "app.logs.max-results", defaultValue = "500")
    int maxLogResults;

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
        int validatedSize = Math.min(Math.max(size, 1), maxPageSize);
        String currentUsername = identity.getPrincipal().getName(); // On récupère le nom tout de suite pour les logs

        // 1. Validation des statuts
        if (status != null && !status.isEmpty()) {
            List<String> invalidStatuses = status.stream()
                    .filter(s -> !VALID_STATUSES.contains(s))
                    .toList();

            if (!invalidStatuses.isEmpty()) {
                LOG.warnf("Valeurs de statut invalides reçues : %s", invalidStatuses);
                return Response.status(400)
                        .entity(Map.of("message", "Valeurs de statut invalides : " + invalidStatuses))
                        .build();
            }
        }

        StringBuilder filter = new StringBuilder();
        Map<String, Object> params = new HashMap<>();

        // 2. Filtres Globaux (Admin et User)
        if (application != null && !application.isBlank()) {
            Application app = Application.findByName(application.trim());
            if (app == null) return emptyResponse(validatedPage, validatedSize);
            filter.append("applicationId = :appId");
            params.put("appId", app.id);
        }

        if (status != null && !status.isEmpty()) {
            if (!filter.isEmpty()) filter.append(" and ");
            filter.append("status IN :status");
            params.put("status", status);
        }

        if (fromStr != null && !fromStr.isBlank()) {
            try {
                if (!filter.isEmpty()) filter.append(" and ");
                filter.append("uploadTimestamp >= :from");
                params.put("from", Instant.parse(fromStr + "T00:00:00Z"));
            } catch (Exception e) {
                return Response.status(400).entity(Map.of("message", "Format de date invalide pour 'from' : " + fromStr)).build();
            }
        }

        if (toStr != null && !toStr.isBlank()) {
            try {
                if (!filter.isEmpty()) filter.append(" and ");
                filter.append("uploadTimestamp <= :to");
                params.put("to", Instant.parse(toStr + "T23:59:59Z"));
            } catch (Exception e) {
                return Response.status(400).entity(Map.of("message", "Format de date invalide pour 'to' : " + toStr)).build();
            }
        }

        // Filtre uploadeur (S'il est saisi manuellement dans la recherche)
        if (uploadedById != null && !uploadedById.isBlank()) {
            if (!filter.isEmpty()) filter.append(" and ");
            filter.append("uploadedById = :uploadedById");
            params.put("uploadedById", uploadedById.trim());
        }

        // 3. Sécurité : Restriction géographique vs Mode ADMIN
        if (!identity.hasRole("ADMIN")) {
            AppUser currentUser = AppUser.findByUsername(currentUsername).orElseThrow(() -> {
                LOG.warnf("Utilisateur non trouvé : %s", currentUsername);
                return new WebApplicationException("Utilisateur non trouvé", 403);
            });

            LOG.debugf("Restriction géographique (Pays: %s, Dép: %d) pour %s",
                    currentUser.countryCode, currentUser.getDepartment(), currentUsername);

            List<String> sameCountryUploaders = AppUser.<AppUser>find(
                            "countryCode = ?1 and department = ?2", currentUser.countryCode, currentUser.getDepartment())
                    .stream().map(AppUser::getUsername).toList();

            if (!filter.isEmpty()) filter.append(" and ");
            filter.append("uploadedById IN :sameCountryUploaders");
            params.put("sameCountryUploaders", sameCountryUploaders);
        } else {
            LOG.info("Accès ADMIN : filtrage géographique désactivé pour " + currentUsername);
        }

        // 4. Exécution de la requête
        Sort sort = Sort.by("uploadTimestamp").descending();
        PanacheQuery<FileBatch> query = filter.isEmpty()
                ? FileBatch.findAll(sort)
                : FileBatch.find(filter.toString(), sort, params);

        List<FileBatch> batches = query.page(Page.of(validatedPage, validatedSize)).list();

        // 5. Mapping DTO
        List<BatchViewDTO> result = List.of();
        if (!batches.isEmpty()) {
            Set<ObjectId> appIds = batches.stream().map(b -> b.applicationId).filter(Objects::nonNull).collect(Collectors.toSet());
            Set<ObjectId> batchIds = batches.stream().map(b -> b.id).collect(Collectors.toSet());

            Map<ObjectId, Application> appsMap = Application.<Application>find("_id in ?1", appIds).stream()
                    .collect(Collectors.toMap(a -> a.id, a -> a));
            Map<ObjectId, BatchStatistics> statsMap = BatchStatistics.<BatchStatistics>find("_id in ?1", batchIds).stream()
                    .collect(Collectors.toMap(s -> s.id, s -> s));

            result = batches.stream().map(batch -> {
                Application app = appsMap.get(batch.applicationId);
                BatchStatistics stats = statsMap.get(batch.id);
                // Resolve uploader's department for the DTO (cached per username)
                String uploaderDept = getCachedUserDepartment(batch.uploadedById);
                return new BatchViewDTO(
                        batch.id.toHexString(),
                        app != null ? app.name : "Inconnu",
                        batch.originalFilename,
                        batch.status,
                        batch.uploadTimestamp,
                        stats != null ? (int) stats.totalRecords : 0,
                        batch.validationReport != null ? batch.validationReport.errors : 0,
                        batch.uploadedById,
                        getCachedUserCountry(batch.uploadedById),
                        uploaderDept,                                   // ✅ department now populated
                        batch.validatedById,
                        batch.validationTimestamp,
                        stats != null ? stats.successCount : 0L,
                        stats != null ? stats.failureCount : 0L
                );
            }).toList();
        }

        LOG.debugf("User %s: %d lots retournés (Page %d)", currentUsername, result.size(), validatedPage);

        return Response.ok(new BatchPageResponse(result, validatedPage, validatedSize, query.count(), query.pageCount())).build();
    }

    /**
     * GET /api/batches/export
     *
     * Dedicated endpoint for the reports page.  Returns all matching batches
     * up to a hard ceiling of 2 000 records — no per-page cap.
     * Accepts the same from/to/application/status params as GET /api/batches.
     *
     * Replaces the broken getQuickStats() which was dead code (no page called
     * it, and its $facet stage referenced a non-existent $totalRecords field).
     */
    @GET
    @Path("/export")
    @Produces(MediaType.APPLICATION_JSON)
    @Operation(summary = "Export complet pour rapports")
    public Response exportForReports(
            @QueryParam("from") String fromStr,
            @QueryParam("to") String toStr,
            @QueryParam("application") String application,
            @QueryParam("status") List<String> status
    ) {
        String currentUsername = identity.getPrincipal().getName();
        boolean isAdmin = identity.hasRole("ADMIN");

        StringBuilder filter = new StringBuilder();
        Map<String, Object> params = new HashMap<>();

        if (application != null && !application.isBlank()) {
            Application app = Application.findByName(application.trim());
            if (app == null) return Response.ok(List.of()).build();
            filter.append("applicationId = :appId");
            params.put("appId", app.id);
        }

        if (status != null && !status.isEmpty()) {
            if (!filter.isEmpty()) filter.append(" and ");
            filter.append("status IN :status");
            params.put("status", status);
        }

        if (fromStr != null && !fromStr.isBlank()) {
            try {
                if (!filter.isEmpty()) filter.append(" and ");
                filter.append("uploadTimestamp >= :from");
                params.put("from", Instant.parse(fromStr + "T00:00:00Z"));
            } catch (Exception e) {
                return Response.status(400).entity(Map.of("message", "Format 'from' invalide")).build();
            }
        }

        if (toStr != null && !toStr.isBlank()) {
            try {
                if (!filter.isEmpty()) filter.append(" and ");
                filter.append("uploadTimestamp <= :to");
                params.put("to", Instant.parse(toStr + "T23:59:59Z"));
            } catch (Exception e) {
                return Response.status(400).entity(Map.of("message", "Format 'to' invalide")).build();
            }
        }

        if (!isAdmin) {
            AppUser currentUser = AppUser.findByUsername(currentUsername).orElse(null);
            if (currentUser == null) return Response.status(403).build();
            List<String> allowed = AppUser.<AppUser>find(
                            "countryCode = ?1 and department = ?2",
                            currentUser.countryCode, currentUser.getDepartment())
                    .stream().map(AppUser::getUsername).toList();
            if (!filter.isEmpty()) filter.append(" and ");
            filter.append("uploadedById IN :allowed");
            params.put("allowed", allowed);
        }

        // Hard ceiling of 2 000 — enough for any realistic report, prevents OOM
        List<FileBatch> batches = (filter.isEmpty()
                ? FileBatch.findAll(Sort.descending("uploadTimestamp"))
                : FileBatch.find(filter.toString(), Sort.descending("uploadTimestamp"), params))
                .page(Page.of(0, 2000)).list();

        if (batches.isEmpty()) return Response.ok(List.of()).build();

        Set<ObjectId> appIds = batches.stream().map(b -> b.applicationId).filter(Objects::nonNull).collect(Collectors.toSet());
        Set<ObjectId> batchIds = batches.stream().map(b -> b.id).collect(Collectors.toSet());

        Map<ObjectId, Application> appsMap = Application.<Application>find("_id in ?1", appIds).stream()
                .collect(Collectors.toMap(a -> a.id, a -> a));
        Map<ObjectId, BatchStatistics> statsMap = BatchStatistics.<BatchStatistics>find("_id in ?1", batchIds).stream()
                .collect(Collectors.toMap(s -> s.id, s -> s));

        List<BatchViewDTO> result = batches.stream().map(batch -> {
            Application app = appsMap.get(batch.applicationId);
            BatchStatistics st = statsMap.get(batch.id);
            return new BatchViewDTO(
                    batch.id.toHexString(),
                    app != null ? app.name : "Inconnu",
                    batch.originalFilename,
                    batch.status,
                    batch.uploadTimestamp,
                    st != null ? (int) st.totalRecords : 0,
                    batch.validationReport != null ? batch.validationReport.errors : 0,
                    batch.uploadedById,
                    getCachedUserCountry(batch.uploadedById),
                    getCachedUserDepartment(batch.uploadedById),
                    batch.validatedById,
                    batch.validationTimestamp,
                    st != null ? st.successCount : 0L,
                    st != null ? st.failureCount : 0L
            );
        }).toList();

        LOG.infof("Export rapport: %d lot(s) retournés pour %s", result.size(), currentUsername);
        return Response.ok(result).build();
    }

    @GET
    @Authenticated
    @Path("/{id}")
    @Produces(MediaType.APPLICATION_JSON)
    @Operation(summary = "Détails complets d'un lot", description = "Retourne les données ligne par ligne et les _links selon le statut courant")
    @APIResponse(responseCode = "200", description = "Lot trouvé")
    @APIResponse(responseCode = "404", description = "Lot non trouvé")
    public Response getBatchById(@PathParam("id") String id) {
        ObjectId bId = parseObjectId(id);
        String path = "/api/v1/batches/" + id;
        FileBatch batch = FileBatch.findById(bId);
        if (batch == null)
            return Response.status(404)
                    .entity(ApiError.of("NOT_FOUND", "Lot non trouvé", path))
                    .build();

        String currentUsername = identity.getPrincipal().getName();
        AppUser currentUser = AppUser.findByUsername(currentUsername).orElse(null);
        if (currentUser == null)
            return Response.status(403)
                    .entity(ApiError.of("FORBIDDEN", "Utilisateur non trouvé", path))
                    .build();

        if (!identity.hasRole("ADMIN")) {
            AppUser uploader = AppUser.findByUsername(batch.uploadedById).orElse(null);
            if (uploader == null
                    || !currentUser.countryCode.equals(uploader.countryCode)
                    || !currentUser.getDepartment().equals(uploader.getDepartment()))
                return Response.status(403)
                        .entity(ApiError.of("FORBIDDEN", "Accès refusé : pays ou département différent", path))
                        .build();
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
                    res != null ? res.status : "EN_ATTENTE",
                    res != null ? res.t24Reference : null,
                    res != null ? res.errorMessage : null
            );
        }).toList();

        return Response.ok(new BatchDetailResponse(
                batch.id.toHexString(),
                getAppName(batch.applicationId),
                batch.originalFilename,
                batch.status,
                batch.uploadTimestamp,
                stats != null ? (int) stats.totalRecords : rows.size(),
                stats != null ? stats.successCount : 0L,
                stats != null ? stats.failureCount : 0L,
                details,
                buildLinks(batch)
        )).build();
    }

    /**
     * POST /api/batches/{id}/reprocess
     * <p>
     * Resets a PROCESSED_FAILED (or PROCESSED_PARTIAL) batch for re-processing:
     * 1. Deletes RowResult records so fresh results are written on retry
     * 2. Resets all FAILED / FAILED_PERMANENT rows to PENDING via native driver
     * 3. Sets batch status back to VALIDATED so the scheduler picks it up
     * <p>
     * Accessible to INPUTTER (own batches only) and ADMIN.
     */
    @POST
    @Path("/{id}/reprocess")
    @RolesAllowed({"INPUTTER", "ADMIN"})
    @Produces(MediaType.APPLICATION_JSON)
    public Response reprocess(@PathParam("id") String id) {
        ObjectId bId = parseObjectId(id);
        FileBatch batch = FileBatch.findById(bId);
        if (batch == null)
            return Response.status(404).entity(Map.of("message", "Lot non trouvé")).build();

        // Ownership check for non-admin
        if (!identity.hasRole("ADMIN")) {
            String me = identity.getPrincipal().getName();
            if (!me.equals(batch.uploadedById))
                return Response.status(403).entity(Map.of("message", "Accès refusé")).build();
        }

        boolean retryable = FileBatch.STATUS_PROCESSED_FAILED.equals(batch.status)
                || "PROCESSED_PARTIAL".equals(batch.status)
                || "PROCESSED_WITH_ERROR".equals(batch.status);
        if (!retryable)
            return Response.status(400).entity(Map.of("message",
                    "Le lot doit être en état ÉCHEC ou PARTIEL pour être relancé")).build();

        // 1. Delete previous RowResult records (stale results from the failed run)
        RowResult.mongoCollection().deleteMany(
                com.mongodb.client.model.Filters.eq("batchId", bId));

        // 2. Reset failed rows to PENDING using native driver (avoids Panache in-list bug)
        BatchData.mongoCollection().updateMany(
                com.mongodb.client.model.Filters.and(
                        com.mongodb.client.model.Filters.eq("batchId", bId),
                        com.mongodb.client.model.Filters.in("processingStatus",
                                "FAILED", "FAILED_PERMANENT", "NO_RESPONSE")
                ),
                com.mongodb.client.model.Updates.combine(
                        com.mongodb.client.model.Updates.set("processingStatus", "PENDING"),
                        com.mongodb.client.model.Updates.set("retryCount", 0),
                        com.mongodb.client.model.Updates.unset("workerId")
                )
        );

        // 3. Reset batch to VALIDATED so the scheduler picks it up
        FileBatch.mongoCollection().updateOne(
                com.mongodb.client.model.Filters.eq("_id", bId),
                com.mongodb.client.model.Updates.set("status", FileBatch.STATUS_VALIDATED)
        );

        // Reset statistics so the next run starts clean
        BatchStatistics.mongoCollection().deleteMany(
                com.mongodb.client.model.Filters.eq("id", bId));

        Log.infof("[%s] Batch remis en traitement par %s",
                bId, identity.getPrincipal().getName());

        return Response.ok(Map.of("message", "Lot remis en traitement")).build();
    }

    /**
     * GET /api/batches/{id}/progress
     * <p>
     * Lightweight polling endpoint for the live progress bar.
     * Called every 3 seconds by the frontend while a batch is PROCESSING.
     * <p>
     * Uses two fast index-backed counts instead of loading all rows:
     * total = BatchData.count(batchId)
     * done  = BatchData.count(batchId + terminal status)
     * <p>
     * Returns the current batch status so the frontend knows when to stop polling.
     */
    @GET
    @Path("/{id}/progress")
    @Produces(MediaType.APPLICATION_JSON)
    public Response getBatchProgress(@PathParam("id") String id) {
        ObjectId bId = parseObjectId(id);
        FileBatch batch = FileBatch.findById(bId);
        if (batch == null)
            return Response.status(404).entity(Map.of("message", "Lot non trouvé")).build();

        // Same geo-restriction as getBatchById — no extra DB hit needed for ADMIN
        if (!identity.hasRole("ADMIN")) {
            String me = identity.getPrincipal().getName();
            AppUser currentUser = AppUser.findByUsername(me).orElse(null);
            if (currentUser == null)
                return Response.status(403).entity(Map.of("message", "Utilisateur non trouvé")).build();
            AppUser uploader = AppUser.findByUsername(batch.uploadedById).orElse(null);
            if (uploader == null
                    || !currentUser.countryCode.equals(uploader.countryCode)
                    || !currentUser.getDepartment().equals(uploader.getDepartment()))
                return Response.status(403).entity(Map.of("message", "Accès refusé")).build();
        }

        long total = BatchData.count("batchId", bId);
        long done = BatchData.count("batchId = ?1 and processingStatus in ?2", bId,
                List.of("COMPLETED", "FAILED", "FAILED_PERMANENT", "NO_RESPONSE"));
        long success = BatchData.count("batchId = ?1 and processingStatus = ?2", bId, "COMPLETED");
        long failed = done - success;  // everything done that isn't success
        int pct = total > 0 ? (int) Math.round(done * 100.0 / total) : 0;

        return Response.ok(Map.of(
                "total", total,
                "done", done,
                "successCount", success,
                "failureCount", failed,
                "pct", pct,
                "status", batch.status
        )).build();
    }

    /**
     * Télécharge le fichier original d'un lot, reconstruit au format CSV à
     * partir des lignes stockées (batch_data). Le fichier brut n'étant pas
     * conservé après l'import, la reconstruction respecte l'ordre des lignes
     * Télécharge le fichier original d'un lot directement depuis GridFS.
     * La réponse est le contenu exact du fichier tel qu'il a été soumis.
     */
    @GET
    @Authenticated
    @Path("/{id}/download")
    @Produces("text/csv")
    public Response downloadOriginalFile(@PathParam("id") String id) {
        ObjectId bId = parseObjectId(id);
        FileBatch batch = FileBatch.findById(bId);
        if (batch == null) return Response.status(404).entity(Map.of("message", "Lot non trouvé")).build();

        // Même contrôle géographique que getBatchById
        String currentUsername = identity.getPrincipal().getName();
        AppUser currentUser = AppUser.findByUsername(currentUsername).orElse(null);
        if (currentUser == null)
            return Response.status(403).entity(Map.of("message", "Utilisateur non trouvé")).build();

        if (!identity.hasRole("ADMIN")) {
            AppUser uploader = AppUser.findByUsername(batch.uploadedById).orElse(null);
            if (uploader == null || !currentUser.countryCode.equals(uploader.countryCode) || !currentUser.getDepartment().equals(uploader.getDepartment())) {
                return Response.status(403).entity(Map.of("message", "Accès refusé : Pays ou département différent")).build();
            }
        }

        if (batch.gridFsFileId == null) {
            return Response.status(404)
                    .type(MediaType.APPLICATION_JSON)
                    .entity(Map.of("message", "Fichier original non disponible (lot importé avant la mise en place du stockage)"))
                    .build();
        }

        try {
            java.io.InputStream stream = gridFsService.open(batch.gridFsFileId);

            String filename = (batch.originalFilename != null && !batch.originalFilename.isBlank())
                    ? batch.originalFilename.replaceAll("[\\r\\n\"]", "_")
                    : "batch_" + batch.id.toHexString() + ".csv";

            LOG.infof("Téléchargement GridFS du lot %s par %s (fileId=%s)",
                    batch.id.toHexString(), currentUsername, batch.gridFsFileId.toHexString());

            return Response.ok(stream)
                    .header("Content-Disposition", "attachment; filename=\"" + filename + "\"")
                    .build();

        } catch (com.mongodb.MongoGridFSException e) {
            LOG.warnf("Fichier GridFS introuvable pour le lot %s : %s", batch.id.toHexString(), e.getMessage());
            return Response.status(404)
                    .type(MediaType.APPLICATION_JSON)
                    .entity(Map.of("message", "Fichier original introuvable dans le stockage"))
                    .build();
        }
    }

    @PUT
    @Path("/{id}")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    @Operation(summary = "Valider un lot (AUTHORISER)", description = "Passe le lot de UPLOADED à VALIDATED. Idempotent via Idempotency-Key.")
    @APIResponse(responseCode = "200", description = "Lot validé")
    @APIResponse(responseCode = "400", description = "Transition invalide")
    @APIResponse(responseCode = "403", description = "Accès refusé")
    @APIResponse(responseCode = "404", description = "Lot non trouvé")
    public Response updateBatchStatus(
            @PathParam("id") String id,
            @HeaderParam("Idempotency-Key") String idempotencyKey,
            BatchUpdateRequest request) {

        String path = "/api/v1/batches/" + id;

        // Replay if this exact validation was already accepted
        Response cached = idempotency.checkAndReturn(idempotencyKey);
        if (cached != null) return cached;

        ObjectId batchId = parseObjectId(id);
        FileBatch batch = FileBatch.findById(batchId);

        if (batch == null)
            return Response.status(404)
                    .entity(ApiError.of("NOT_FOUND", "Lot non trouvé", path))
                    .build();

        String validatorName = identity.getPrincipal().getName();
        AppUser validator = AppUser.findByUsername(validatorName).orElse(null);
        AppUser inputter = AppUser.findByUsername(batch.uploadedById).orElse(null);

        if (validator == null || inputter == null)
            return Response.status(403)
                    .entity(ApiError.of("FORBIDDEN", "Contexte utilisateur manquant", path))
                    .build();

        if (!validator.countryCode.equals(inputter.countryCode)
                || !validator.getDepartment().equals(inputter.getDepartment()))
            return Response.status(403)
                    .entity(ApiError.of("FORBIDDEN", "Permission refusée : pays ou département différent", path))
                    .build();

        if (!FileBatch.STATUS_VALIDATED.equals(request.status()))
            return Response.status(400)
                    .entity(ApiError.of("BAD_REQUEST", "Transition de statut invalide", path))
                    .build();

        if (!FileBatch.STATUS_UPLOADED.equals(batch.status))
            return Response.status(409)
                    .entity(ApiError.of("CONFLICT",
                            "Le lot n'est pas dans l'état UPLOADED (actuel: " + batch.status + ")", path))
                    .build();

        batch.status = FileBatch.STATUS_VALIDATED;
        batch.validatedById = validatorName;
        batch.validationTimestamp = Instant.now();

        BatchStatistics stats = BatchStatistics.calculate(batchId);
        if (stats != null) stats.persistOrUpdate();
        batch.update();

        AdminAuditLog.record(validatorName, AdminAuditLog.BATCH_VALIDATED, id,
                "Lot " + batch.originalFilename + " validé et envoyé en traitement",
                Map.of("application", getAppName(batch.applicationId),
                        "filename", String.valueOf(batch.originalFilename)));

        LOG.infof("Lot %s validé par %s", id, validatorName);

        var body = Map.of("message", "Lot validé avec succès", "batchId", id, "status", "VALIDATED");
        idempotency.store(idempotencyKey, 200, "{\"message\":\"Lot validé avec succès\",\"batchId\":\"" + id + "\",\"status\":\"VALIDATED\"}");
        return Response.ok(body).build();
    }

    @DELETE
    @Path("/{id}")
    public Response deleteBatchById(@PathParam("id") String id) {
        // ... (Votre code existant reste inchangé ici) ...
        ObjectId batchId = parseObjectId(id);
        FileBatch batch = FileBatch.findById(batchId);

        if (batch == null) return Response.status(404).entity(Map.of("message", "Lot non trouvé")).build();

        String currentUsername = identity.getPrincipal().getName();
        AppUser currentUser = AppUser.findByUsername(currentUsername).orElse(null);
        if (currentUser == null)
            return Response.status(403).entity(Map.of("message", "Utilisateur non trouvé")).build();

        if (!identity.hasRole("ADMIN")) {
            AppUser uploader = AppUser.findByUsername(batch.uploadedById).orElse(null);
            if (uploader == null || !currentUser.countryCode.equals(uploader.countryCode) || !currentUser.getDepartment().equals(uploader.getDepartment())) {
                return Response.status(403).entity(Map.of("message", "Accès refusé : Pays ou département différent")).build();
            }
        }

        List<String> deletable = List.of(FileBatch.STATUS_UPLOADED, FileBatch.STATUS_UPLOADED_FAILED, FileBatch.STATUS_VALIDATED_FAILED);
        if (!deletable.contains(batch.status))
            return Response.status(403).entity(Map.of("message", "Impossible de supprimer un lot avec le statut : " + batch.status)).build();

        BatchData.delete("batchId", batchId);
        RowResult.delete("batchId", batchId);
        BatchStatistics.deleteById(batchId);
        ProcessingLogEntry.delete("batchId", batchId);
        batch.delete();

        AdminAuditLog.record(currentUsername, AdminAuditLog.BATCH_DELETED, id,
                "Lot supprimé : " + batch.originalFilename,
                Map.of("status", batch.status,
                        "filename", String.valueOf(batch.originalFilename)));

        LOG.infof("Lot %s supprimé par %s", id, currentUsername);
        return Response.noContent().build();
    }

    @GET
    @Path("/recent-batches")
    @Produces(MediaType.APPLICATION_JSON)
    public Response getRecentBatches() {
        List<RecentBatchDTO> list = FileBatch.<FileBatch>findAll(Sort.descending("uploadTimestamp"))
                .page(Page.of(0, 10)).stream().map(batch -> new RecentBatchDTO(batch.id.toHexString(), batch.status, batch.uploadTimestamp)).toList();
        return Response.ok(list).build();
    }

    @GET
    @Path("/processing-logs")
    @Produces(MediaType.APPLICATION_JSON)
    public List<ProcessingLogEntry> getProcessingLogs(@QueryParam("batchId") String batchId) {
        if (batchId != null && !batchId.isBlank()) {
            // Safe parse — don't use parseObjectId() which throws on invalid input
            ObjectId bId;
            try {
                bId = new ObjectId(batchId);
            } catch (Exception e) {
                return List.of();
            }
            if (FileBatch.findById(bId) == null) return List.of();
            return ProcessingLogEntry.find("batchId", Sort.by("timestamp").descending(), bId)
                    .page(Page.of(0, maxLogResults)).list();
        }
        return ProcessingLogEntry.findAll(Sort.by("timestamp").descending())
                .page(Page.of(0, maxLogResults)).list();
    }

    @GET
    @Path("/counts")
    @Produces(MediaType.APPLICATION_JSON)
    public Map<String, Long> getBatchCounts(@QueryParam("uploadedById") String inputter) {
        // ... (Votre code existant reste inchangé ici) ...
        Map<String, Long> counts = new HashMap<>();
        String currentUsername = identity.getPrincipal().getName();
        AppUser currentUser = AppUser.findByUsername(currentUsername).orElse(null);
        if (currentUser == null) return counts;

        boolean isAdmin = identity.hasRole("ADMIN");
        String currentCountry = currentUser.countryCode;
        Integer currentDepartment = currentUser.getDepartment();

        List<String> allowedUploaders = isAdmin ? null : AppUser.<AppUser>find("countryCode = ?1 and department = ?2", currentCountry, currentDepartment).stream().map(AppUser::getUsername).toList();
        boolean filterBySpecificInputter = inputter != null && !inputter.isBlank();

        for (String status : VALID_STATUSES) {
            long count = 0;
            if (isAdmin) {
                count = filterBySpecificInputter && AppUser.findByUsername(inputter).isPresent()
                        ? FileBatch.count("status = ?1 and uploadedById = ?2", status, inputter)
                        : FileBatch.count("status = ?1", status);
            } else {
                if (filterBySpecificInputter) {
                    AppUser specificInputter = AppUser.findByUsername(inputter).orElse(null);
                    if (specificInputter != null && currentCountry.equals(specificInputter.countryCode) && currentDepartment.equals(specificInputter.getDepartment())) {
                        count = FileBatch.count("status = ?1 and uploadedById = ?2", status, inputter);
                    }
                } else if (!allowedUploaders.isEmpty()) {
                    count = FileBatch.count("status = ?1 and uploadedById IN ?2", status, allowedUploaders);
                }
            }
            counts.put(status, count);
        }
        return counts;
    }

    // --- UTILITIES ---

    private String getAppName(ObjectId appId) {
        if (appId == null) return "Inconnu";
        try {
            return applicationCache.get(appId, id -> {
                Application app = Application.findById(id);
                return app != null ? app.name : "Inconnu";
            }).await().indefinitely();
        } catch (Exception e) {
            return "Inconnu";
        }
    }

    private String getCachedUserCountry(String username) {
        if (username == null) return "XX";
        try {
            return userCountryCache.get(username, key ->
                    AppUser.findByUsername(key.toString()).map(u -> u.countryCode).orElse("XX")
            ).await().indefinitely();
        } catch (Exception e) {
            LOG.warnf(e, "Échec récupération pays pour : %s", username);
            return "XX";
        }
    }

    private String getCachedUserDepartment(String username) {
        if (username == null) return "-";
        try {
            return userCountryCache.get("dept:" + username, key -> {
                String u = key.toString().substring(5); // strip "dept:" prefix
                return AppUser.findByUsername(u)
                        .map(usr -> usr.getDepartment() != null ? String.valueOf(usr.getDepartment()) : "-")
                        .orElse("-");
            }).await().indefinitely();
        } catch (Exception e) {
            return "-";
        }
    }

    private Response emptyResponse(int page, int size) {
        return Response.ok(new BatchPageResponse(List.of(), page, size, 0, 0)).build();
    }

    /**
     * Build HATEOAS _links based on current batch status
     */
    private Map<String, String> buildLinks(FileBatch batch) {
        String id = batch.id.toHexString();
        String base = "/api/v1/batches/" + id;
        var links = new LinkedHashMap<String, String>();
        links.put("self", base);
        links.put("rows", base + "/rows");
        links.put("download", base + "/download");
        switch (batch.status) {
            case "UPLOADED" -> links.put("submit", base);
            case "PROCESSING" -> links.put("progress", base + "/progress");
            case "PROCESSED_FAILED", "PROCESSED_WITH_ERROR" -> links.put("reprocess", base + "/reprocess");
        }
        return links;
    }

    // --- PAGINATED ROWS ENDPOINT ---

    @GET
    @Path("/{id}/rows")
    @Produces(MediaType.APPLICATION_JSON)
    @Operation(summary = "Lignes d'un lot (paginées)",
            description = "Retourne les résultats ligne par ligne. Filtrable par status=FAILED|SUCCESS.")
    @APIResponse(responseCode = "200", description = "Page de lignes")
    @APIResponse(responseCode = "404", description = "Lot non trouvé")
    public Response getBatchRows(
            @PathParam("id") String id,
            @Parameter(description = "Filtrer par statut: FAILED, SUCCESS")
            @QueryParam("status") String rowStatus,
            @QueryParam("page") @DefaultValue("0") int page,
            @QueryParam("size") @DefaultValue("50") int size
    ) {
        ObjectId bId = parseObjectId(id);
        String path = "/api/v1/batches/" + id + "/rows";

        FileBatch batch = FileBatch.findById(bId);
        if (batch == null)
            return Response.status(404)
                    .entity(ApiError.of("NOT_FOUND", "Lot non trouvé", path))
                    .build();

        int validSize = Math.min(Math.max(size, 1), 100); // hard cap at 100
        int validPage = Math.max(page, 0);

        PanacheQuery<RowResult> query = rowStatus != null && !rowStatus.isBlank()
                ? RowResult.find("batchId = ?1 and status = ?2", bId, rowStatus.toUpperCase())
                : RowResult.find("batchId = ?1", bId);

        List<RowResult> rows = query.page(Page.of(validPage, validSize)).list();
        long total = query.count();

        record RowPage(List<RowResult> items, long total, int page, int size, long totalPages) {
        }
        return Response.ok(new RowPage(rows, total, validPage, validSize,
                (long) Math.ceil((double) total / validSize))).build();
    }

    // --- DTOs ---

    private ObjectId parseObjectId(String id) {
        try {
            return new ObjectId(id);
        } catch (IllegalArgumentException e) {
            throw new WebApplicationException(
                    Response.status(400)
                            .entity(ApiError.of("BAD_REQUEST", "Format d'ID invalide",
                                    "/api/v1/batches/" + id))
                            .build());
        }
    }

    public record BatchViewDTO(
            String batchId,
            String application,
            String originalFilename,
            String status,
            Instant uploadedAt,
            int totalRecords,
            int errorCount,
            String uploadedBy,
            String country,
            String department,
            String validatedBy,
            Instant validatedAt,
            long successCount,
            long failureCount
    ) {
    }

    public record BatchUpdateRequest(String status) {
        @JsonCreator
        public BatchUpdateRequest(@JsonProperty("status") String status) {
            this.status = status;
        }
    }

    /**
     * Pagination wrapper — `items` holds the current page, `total` is the full count.
     */
    public record BatchPageResponse(List<BatchViewDTO> items, int page, int size, long total, long totalPages) {}

    @Schema(name = "RowDetailDTO")
    public record RowDetailDTO(int lineNumber, Map<String, Object> data, String status,
                               String t24Reference, String errorMessage) {}

    @Schema(name = "RecentBatchDTO")
    public record RecentBatchDTO(String id, String status, Instant uploadedAt) {}

    // --- UTILITIES ---

    @Schema(name = "BatchDetailResponse")
    public record BatchDetailResponse(
            String batchId, String application, String originalFilename, String status,
            Instant uploadedAt, int totalRecords,
            long successCount, long failureCount,
            List<RowDetailDTO> details,
            Map<String, String> _links) {
    }
}