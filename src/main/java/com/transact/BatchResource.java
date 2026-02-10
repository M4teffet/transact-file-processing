package com.transact;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.transact.processor.model.*;
import io.quarkus.cache.Cache;
import io.quarkus.cache.CacheName;
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

        // Validation des statuts
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

        // Filtre par application
        if (application != null && !application.isBlank()) {
            Application app = Application.findByName(application.trim());
            if (app == null) return emptyResponse(validatedPage, validatedSize);
            filter.append("applicationId = :appId");
            params.put("appId", app.id);
        }

        // Filtre par statut
        if (status != null && !status.isEmpty()) {
            if (!filter.isEmpty()) filter.append(" and ");
            filter.append("status IN :status");
            params.put("status", status);
        }

        // Filtre par utilisateur uploadeur
        if (uploadedById != null && !uploadedById.isBlank()) {
            if (!filter.isEmpty()) filter.append(" and ");
            filter.append("uploadedById = :uploadedById");
            params.put("uploadedById", uploadedById.trim());
        }

        // Contrôle d'accès par pays et département
        String currentUsername = identity.getPrincipal().getName();
        AppUser currentUser = AppUser.findByUsername(currentUsername).orElse(null);

        if (currentUser == null) {
            LOG.warnf("Utilisateur non trouvé : %s", currentUsername);
            throw new WebApplicationException("Utilisateur non trouvé", 403);
        }

        String currentCountry = currentUser.countryCode;
        Integer currentDepartmentId = currentUser.getDepartment();

        LOG.debugf("Filtrage des lots pour l'utilisateur : %s (pays : %s, dép. : %d)",
                currentUsername, currentCountry, currentDepartmentId);

        // Récupérer les utilisateurs du même pays et département
        List<String> sameCountryUploaders =
                AppUser.<AppUser>find(
                                "countryCode = ?1 and department = ?2",
                                currentCountry,
                                currentDepartmentId
                        )
                        .list()
                        .stream()
                        .map(AppUser::getUsername)
                        .collect(Collectors.toList());

        LOG.tracef("Nombre d'uploadeurs autorisés trouvés : %d", sameCountryUploaders.size());

        if (!filter.isEmpty()) filter.append(" and ");
        filter.append("uploadedById IN :sameCountryUploaders");
        params.put("sameCountryUploaders", sameCountryUploaders);

        // Requête paginée
        Sort sort = Sort.by("uploadTimestamp").descending();
        PanacheQuery<FileBatch> query = filter.isEmpty()
                ? FileBatch.findAll(sort)
                : FileBatch.find(filter.toString(), sort, params);

        List<FileBatch> batches = query.page(Page.of(validatedPage, validatedSize)).list();

        List<BatchViewDTO> result;
        if (batches.isEmpty()) {
            result = List.of();
        } else {
            // Récupération en masse des applications et statistiques
            Set<ObjectId> appIds = batches.stream()
                    .map(b -> b.applicationId)
                    .filter(Objects::nonNull)
                    .collect(Collectors.toSet());

            Set<ObjectId> batchIds = batches.stream()
                    .map(b -> b.id)
                    .collect(Collectors.toSet());

            Map<ObjectId, Application> appsMap = Application.<Application>find("_id in ?1", appIds)
                    .stream()
                    .collect(Collectors.toMap(a -> a.id, a -> a));

            Map<ObjectId, BatchStatistics> statsMap = BatchStatistics.<BatchStatistics>find("_id in ?1", batchIds)
                    .stream()
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
                        batch.validationReport != null ? batch.validationReport.errors : 0
                );
            }).collect(Collectors.toList());
        }

        LOG.debugf("Retour de %d lots pour l'utilisateur %s (page %d)",
                Optional.of(result.size()), currentUsername, validatedPage);

        return Response.ok(new BatchPageResponse(result, validatedPage, validatedSize, query.count(), query.pageCount())).build();
    }

    @GET
    @Authenticated
    @Path("/{id}")
    @Produces(MediaType.APPLICATION_JSON)
    @Operation(summary = "Détails d'un lot", description = "Combine métadonnées, données brutes et résultats de traitement")
    public Response getBatchById(@PathParam("id") String id) {
        ObjectId bId = parseObjectId(id);

        FileBatch batch = FileBatch.findById(bId);
        if (batch == null) {
            LOG.debugf("Lot non trouvé : %s", id);
            return Response.status(404)
                    .entity(Map.of("message", "Lot non trouvé"))
                    .build();
        }

        // Contrôle d'accès
        String currentUsername = identity.getPrincipal().getName();
        AppUser currentUser = AppUser.findByUsername(currentUsername).orElse(null);

        if (currentUser == null) {
            LOG.warnf("Utilisateur non trouvé : %s", currentUsername);
            return Response.status(403)
                    .entity(Map.of("message", "Utilisateur non trouvé"))
                    .build();
        }

        String currentCountry = currentUser.countryCode;
        Integer currentDepartment = currentUser.getDepartment();
        AppUser uploader = AppUser.findByUsername(batch.uploadedById).orElse(null);

        if (uploader == null ||
                !currentCountry.equals(uploader.countryCode) ||
                !currentDepartment.equals(uploader.getDepartment())) {
            LOG.warnf("Accès refusé : L'utilisateur %s a tenté d'accéder au lot %s", currentUsername, id);
            return Response.status(403)
                    .entity(Map.of("message", "Accès refusé : Pays ou département différent"))
                    .build();
        }

        // Récupération des données
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
        }).collect(Collectors.toList());

        LOG.debugf("Retour des détails du lot %s (%d lignes)", id, details.size());

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
        ObjectId batchId = parseObjectId(id);
        FileBatch batch = FileBatch.findById(batchId);

        if (batch == null) {
            return Response.status(404)
                    .entity(Map.of("message", "Lot non trouvé"))
                    .build();
        }

        // Vérification des autorisations
        String validatorName = identity.getPrincipal().getName();
        AppUser validator = AppUser.findByUsername(validatorName).orElse(null);

        String inputterName = batch.uploadedById;
        AppUser inputter = AppUser.findByUsername(inputterName).orElse(null);

        if (validator == null || inputter == null) {
            return Response.status(403)
                    .entity(Map.of("message", "Contexte utilisateur manquant"))
                    .build();
        }

        if (!validator.countryCode.equals(inputter.countryCode) ||
                !validator.getDepartment().equals(inputter.getDepartment())) {
            LOG.warnf("Permission refusée : Le validateur %s a tenté de valider un lot d'un pays/département différent",
                    validatorName);
            return Response.status(403)
                    .entity(Map.of("message", "Permission refusée : Pays ou département différent"))
                    .build();
        }

        // Validation du statut
        if (!FileBatch.STATUS_VALIDATED.equals(request.status())) {
            return Response.status(400)
                    .entity(Map.of("message", "Transition de statut invalide"))
                    .build();
        }

        if (!FileBatch.STATUS_UPLOADED.equals(batch.status)) {
            return Response.status(403)
                    .entity(Map.of("message", "Le lot n'est pas dans l'état UPLOADED"))
                    .build();
        }

        // Mise à jour du lot
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
        ObjectId batchId = parseObjectId(id);
        FileBatch batch = FileBatch.findById(batchId);

        if (batch == null) {
            return Response.status(404)
                    .entity(Map.of("message", "Lot non trouvé"))
                    .build();
        }

        // Contrôle d'accès
        String currentUsername = identity.getPrincipal().getName();
        AppUser currentUser = AppUser.findByUsername(currentUsername).orElse(null);

        if (currentUser == null) {
            return Response.status(403)
                    .entity(Map.of("message", "Utilisateur non trouvé"))
                    .build();
        }

        String currentCountry = currentUser.countryCode;
        Integer currentDepartment = currentUser.getDepartment();
        AppUser uploader = AppUser.findByUsername(batch.uploadedById).orElse(null);

        if (uploader == null ||
                !currentCountry.equals(uploader.countryCode) ||
                !currentDepartment.equals(uploader.getDepartment())) {
            LOG.warnf("Accès refusé : L'utilisateur %s a tenté de supprimer le lot %s", currentUsername, id);
            return Response.status(403)
                    .entity(Map.of("message", "Accès refusé : Pays ou département différent"))
                    .build();
        }

        // Vérification du statut pour suppression
        List<String> deletable = List.of(
                FileBatch.STATUS_UPLOADED,
                FileBatch.STATUS_UPLOADED_FAILED,
                FileBatch.STATUS_VALIDATED_FAILED
        );

        if (!deletable.contains(batch.status)) {
            return Response.status(403)
                    .entity(Map.of("message", "Impossible de supprimer un lot avec le statut : " + batch.status))
                    .build();
        }

        // Suppression en cascade
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
    @Operation(
            summary = "Récupérer les lots les plus récents",
            description = "Retourne les 10 lots les plus récents (tous utilisateurs confondus). "
                    + "Aucune restriction par pays/département/uploadeur n'est appliquée."
    )
    public Response getRecentBatches() {

        List<RecentBatchDTO> list = FileBatch.<FileBatch>findAll(
                        Sort.descending("uploadTimestamp")
                )
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

    @GET
    @Path("/processing-logs")
    @Produces(MediaType.APPLICATION_JSON)
    @Operation(
            summary = "Récupérer les logs de traitement",
            description = "Retourne les logs de traitement pour un lot spécifique (batchId) ou les logs les plus récents si aucun batchId n'est fourni. "
                    + "Aucune restriction par utilisateur/pays/département n'est appliquée."
    )
    public List<ProcessingLogEntry> getProcessingLogs(@QueryParam("batchId") String batchId) {

        // ------------------------------------------------------------------------
        // CASE 1: Specific batch requested
        // ------------------------------------------------------------------------
        if (batchId != null && !batchId.isBlank()) {
            ObjectId bId = parseObjectId(batchId);
            if (bId == null) {
                LOG.warnf("batchId invalide : %s", batchId);
                return List.of();
            }

            FileBatch batch = FileBatch.findById(bId);
            if (batch == null) {
                return List.of();
            }

            // Return logs for this batch — no permission check
            return ProcessingLogEntry.find("batchId", Sort.by("timestamp").descending(), bId)
                    .page(Page.of(0, maxLogResults))
                    .list();
        }

        // ------------------------------------------------------------------------
        // CASE 2: No batchId → return most recent logs across ALL batches
        // ------------------------------------------------------------------------
        return ProcessingLogEntry.findAll(Sort.by("timestamp").descending())
                .page(Page.of(0, maxLogResults))
                .list();
    }


    @GET
    @Path("/counts")
    @Produces(MediaType.APPLICATION_JSON)
    @Operation(
            summary = "Statistiques par statut",
            description = "Retourne le nombre de lots par statut. Les administrateurs voient toutes les données, "
                    + "les utilisateurs normaux voient seulement leur pays/département (ou un uploadeur spécifique du même pays/département)."
    )
    public Map<String, Long> getBatchCounts(@QueryParam("uploadedById") String inputter) {
        Map<String, Long> counts = new HashMap<>();

        String currentUsername = identity.getPrincipal().getName();
        AppUser currentUser = AppUser.findByUsername(currentUsername).orElse(null);

        if (currentUser == null) {
            LOG.warnf("Utilisateur non trouvé : %s", currentUsername);
            return counts; // ou throw exception selon votre politique
        }

        boolean isAdmin = identity.hasRole("ADMIN");

        String currentCountry = currentUser.countryCode;
        Integer currentDepartment = currentUser.getDepartment();

        // Préparation des uploadeurs autorisés (pour utilisateurs normaux)
        List<String> allowedUploaders;
        if (isAdmin) {
            // Admin voit tout → pas de filtre sur uploadedById
            allowedUploaders = null; // on utilisera une requête sans filtre
        } else {
            allowedUploaders = AppUser.<AppUser>find(
                            "countryCode = ?1 and department = ?2",
                            currentCountry,
                            currentDepartment
                    )
                    .list()
                    .stream()
                    .map(AppUser::getUsername)
                    .collect(Collectors.toList());
        }

        boolean filterBySpecificInputter = inputter != null && !inputter.isBlank();

        for (String status : VALID_STATUSES) {
            long count;

            if (isAdmin) {
                // Administrateur : voit tout
                if (filterBySpecificInputter) {
                    // Vérifie que l'utilisateur existe (optionnel mais recommandé)
                    boolean inputterExists = AppUser.findByUsername(inputter).isPresent();
                    count = inputterExists
                            ? FileBatch.count("status = ?1 and uploadedById = ?2", status, inputter)
                            : 0;
                } else {
                    // Tous les batches, tous statuts
                    count = FileBatch.count("status = ?1", status);
                }
            } else {
                // Utilisateur normal
                if (filterBySpecificInputter) {
                    AppUser specificInputter = AppUser.findByUsername(inputter).orElse(null);
                    if (specificInputter == null ||
                            !currentCountry.equals(specificInputter.countryCode) ||
                            !currentDepartment.equals(specificInputter.getDepartment())) {
                        count = 0;
                    } else {
                        count = FileBatch.count("status = ?1 and uploadedById = ?2", status, inputter);
                    }
                } else {
                    // Tous les uploadeurs du même pays/département
                    if (allowedUploaders.isEmpty()) {
                        count = 0;
                    } else {
                        count = FileBatch.count("status = ?1 and uploadedById IN ?2", status, allowedUploaders);
                    }
                }
            }

            counts.put(status, count);
        }

        return counts;
    }


    private ObjectId parseObjectId(String id) {
        try {
            return new ObjectId(id);
        } catch (IllegalArgumentException e) {
            LOG.debugf("Format d'ObjectId invalide : %s", id);
            throw new WebApplicationException(
                    Response.status(400)
                            .entity(Map.of("message", "Format d'ID invalide"))
                            .build()
            );
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
            LOG.warnf(e, "Échec de récupération du nom d'application pour l'ID : %s", appId);
            return "Inconnu";
        }
    }

    private Response emptyResponse(int page, int size) {
        return Response.ok(new BatchPageResponse(List.of(), page, size, 0, 0)).build();
    }

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
            String status,
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