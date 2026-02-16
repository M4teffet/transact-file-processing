package com.transact;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.transact.processor.model.*;
import io.quarkus.cache.Cache;
import io.quarkus.cache.CacheName;
import io.quarkus.mongodb.panache.PanacheMongoEntityBase;
import io.quarkus.mongodb.panache.PanacheQuery;
import io.quarkus.panache.common.Page;
import io.quarkus.panache.common.Sort;
import io.quarkus.security.Authenticated;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.inject.Inject;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.bson.Document;
import org.bson.types.ObjectId;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.media.Schema;
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
@Path("/api/batches")
@Tag(name = "Lots", description = "Consultation des lots de fichiers uploadés")
@Authenticated
public class BatchResource {

    private static final Logger LOG = Logger.getLogger(BatchResource.class);

    @Inject
    SecurityIdentity identity;

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
            if (!filter.isEmpty()) filter.append(" and ");
            filter.append("uploadTimestamp >= :from");
            params.put("from", Instant.parse(fromStr + "T00:00:00Z"));
        }

        if (toStr != null && !toStr.isBlank()) {
            if (!filter.isEmpty()) filter.append(" and ");
            filter.append("uploadTimestamp <= :to");
            params.put("to", Instant.parse(toStr + "T23:59:59Z"));
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
                        batch.validatedById,
                        batch.validationTimestamp

                );
            }).toList();
        }

        LOG.debugf("User %s: %d lots retournés (Page %d)", currentUsername, result.size(), validatedPage);

        return Response.ok(new BatchPageResponse(result, validatedPage, validatedSize, query.count(), query.pageCount())).build();
    }

    /**
     * NOUVEAU POINT DE TERMINAISON POUR LE TABLEAU DE BORD (reports.js)
     * Utilise MongoDB Aggregation Framework pour des statistiques ultra-rapides.
     */
    @GET
    @Path("/stats")
    @Produces(MediaType.APPLICATION_JSON)
    @Operation(summary = "Statistiques agrégées", description = "Fournit les données statistiques optimisées pour le dashboard")
    public Response getQuickStats(
            @QueryParam("from") String fromStr,
            @QueryParam("to") String toStr
    ) {
        String currentUsername = identity.getPrincipal().getName();
        AppUser currentUser = AppUser.findByUsername(currentUsername).orElseThrow(() ->
                new WebApplicationException("Utilisateur non trouvé", 403));

        List<String> allowedUploaders = AppUser.<AppUser>find("countryCode = ?1 and department = ?2",
                        currentUser.countryCode, currentUser.getDepartment())
                .stream().map(AppUser::getUsername).toList();

        // 1. Stage de filtre (Match)
        Document matchStage = new Document("uploadedById", new Document("$in", allowedUploaders));

        if (fromStr != null && !fromStr.isBlank() && toStr != null && !toStr.isBlank()) {
            matchStage.append("uploadTimestamp", new Document("$gte", Instant.parse(fromStr + "T00:00:00Z"))
                    .append("$lte", Instant.parse(toStr + "T23:59:59Z")));
        }

        // 2. Stage de classification parallèle (Facet)
        Document facetStage = new Document()
                .append("byStatus", List.of(
                        new Document("$group", new Document("_id", "$status").append("count", new Document("$sum", 1)))
                ))
                .append("byApp", List.of(
                        new Document("$group", new Document("_id", "$applicationId")
                                .append("totalBatches", new Document("$sum", 1))
                                .append("totalRecords", new Document("$sum", "$totalRecords")) // Assurez-vous d'avoir ce champ
                        )
                ));

        // Exécution de l'agrégation
        PanacheMongoEntityBase result = FileBatch.mongoCollection().aggregate(List.of(
                new Document("$match", matchStage),
                new Document("$facet", facetStage)
        )).first();

        return Response.ok(result != null ? result : Map.of()).build();
    }

    @GET
    @Authenticated
    @Path("/{id}")
    @Produces(MediaType.APPLICATION_JSON)
    public Response getBatchById(@PathParam("id") String id) {
        // ... (Votre code existant reste inchangé ici) ...
        ObjectId bId = parseObjectId(id);
        FileBatch batch = FileBatch.findById(bId);
        if (batch == null) return Response.status(404).entity(Map.of("message", "Lot non trouvé")).build();

        String currentUsername = identity.getPrincipal().getName();
        AppUser currentUser = AppUser.findByUsername(currentUsername).orElse(null);
        if (currentUser == null) return Response.status(403).entity(Map.of("message", "Utilisateur non trouvé")).build();

        AppUser uploader = AppUser.findByUsername(batch.uploadedById).orElse(null);
        if (uploader == null || !currentUser.countryCode.equals(uploader.countryCode) || !currentUser.getDepartment().equals(uploader.getDepartment())) {
            return Response.status(403).entity(Map.of("message", "Accès refusé : Pays ou département différent")).build();
        }

        List<BatchData> rows = BatchData.findByBatchId(bId);
        List<RowResult> results = RowResult.find("batchId", bId).list();
        BatchStatistics stats = BatchStatistics.findById(bId);

        Map<Integer, RowResult> resultMap = results.stream().collect(Collectors.toMap(r -> r.lineNumber, r -> r));

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
                details
        )).build();
    }

    @PUT
    @Path("/{id}")
    @Consumes(MediaType.APPLICATION_JSON)
    public Response updateBatchStatus(@PathParam("id") String id, BatchUpdateRequest request) {
        // ... (Votre code existant reste inchangé ici) ...
        ObjectId batchId = parseObjectId(id);
        FileBatch batch = FileBatch.findById(batchId);

        if (batch == null) return Response.status(404).entity(Map.of("message", "Lot non trouvé")).build();

        String validatorName = identity.getPrincipal().getName();
        AppUser validator = AppUser.findByUsername(validatorName).orElse(null);
        AppUser inputter = AppUser.findByUsername(batch.uploadedById).orElse(null);

        if (validator == null || inputter == null)
            return Response.status(403).entity(Map.of("message", "Contexte utilisateur manquant")).build();

        if (!validator.countryCode.equals(inputter.countryCode) || !validator.getDepartment().equals(inputter.getDepartment())) {
            return Response.status(403).entity(Map.of("message", "Permission refusée : Pays ou département différent")).build();
        }

        if (!FileBatch.STATUS_VALIDATED.equals(request.status()))
            return Response.status(400).entity(Map.of("message", "Transition de statut invalide")).build();
        if (!FileBatch.STATUS_UPLOADED.equals(batch.status))
            return Response.status(403).entity(Map.of("message", "Le lot n'est pas dans l'état UPLOADED")).build();

        batch.status = FileBatch.STATUS_VALIDATED;
        batch.validatedById = validatorName;
        batch.validationTimestamp = Instant.now();

        BatchStatistics stats = BatchStatistics.calculate(batchId);
        if (stats != null) stats.persistOrUpdate();
        batch.update();

        LOG.infof("Lot %s validé par %s", id, validatorName);
        return Response.ok(Map.of("message", "Lot validé avec succès")).build();
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
        if (currentUser == null) return Response.status(403).entity(Map.of("message", "Utilisateur non trouvé")).build();

        AppUser uploader = AppUser.findByUsername(batch.uploadedById).orElse(null);
        if (uploader == null || !currentUser.countryCode.equals(uploader.countryCode) || !currentUser.getDepartment().equals(uploader.getDepartment())) {
            return Response.status(403).entity(Map.of("message", "Accès refusé : Pays ou département différent")).build();
        }

        List<String> deletable = List.of(FileBatch.STATUS_UPLOADED, FileBatch.STATUS_UPLOADED_FAILED, FileBatch.STATUS_VALIDATED_FAILED);
        if (!deletable.contains(batch.status))
            return Response.status(403).entity(Map.of("message", "Impossible de supprimer un lot avec le statut : " + batch.status)).build();

        BatchData.delete("batchId", batchId);
        RowResult.delete("batchId", batchId);
        BatchStatistics.deleteById(batchId);
        ProcessingLogEntry.delete("batchId", batchId);
        batch.delete();

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
            ObjectId bId = parseObjectId(batchId);
            if (bId == null || FileBatch.findById(bId) == null) return List.of();
            return ProcessingLogEntry.find("batchId", Sort.by("timestamp").descending(), bId).page(Page.of(0, maxLogResults)).list();
        }
        return ProcessingLogEntry.findAll(Sort.by("timestamp").descending()).page(Page.of(0, maxLogResults)).list();
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

    private ObjectId parseObjectId(String id) {
        try {
            return new ObjectId(id);
        } catch (IllegalArgumentException e) {
            throw new WebApplicationException(Response.status(400).entity(Map.of("message", "Format d'ID invalide")).build());
        }
    }

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
            return userCountryCache.get(username, key -> {
                return AppUser.findByUsername(key.toString()).map(u -> u.countryCode).orElse("XX");
            }).await().indefinitely();
        } catch (Exception e) {
            LOG.warnf(e, "Échec de récupération du pays pour l'utilisateur : %s", username);
            return "XX";
        }
    }

    private Response emptyResponse(int page, int size) {
        return Response.ok(new BatchPageResponse(List.of(), page, size, 0, 0)).build();
    }

    // --- DTOs ---

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
            String validatedBy,
            Instant validatedAt
    ) {
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
    public record RowDetailDTO(int lineNumber, Map<String, Object> data, String status, String t24Reference,
                               String errorMessage) {
    }

    @Schema(name = "RecentBatchDTO")
    public record RecentBatchDTO(String id, String status, Instant uploadedAt) {
    }

    @Schema(name = "BatchDetailResponse")
    public record BatchDetailResponse(String batchId, String application, String originalFilename, String status,
                                      Instant uploadedAt, int totalRecords, List<RowDetailDTO> details) {
    }
}