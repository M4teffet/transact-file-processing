package com.transact;

import com.transact.processor.model.Country;
import io.quarkus.panache.common.Sort;
import jakarta.annotation.security.RolesAllowed;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/**
 * CountryResource - VERSION FRANÇAISE
 * <p>
 * ✅ Tous les messages et logs en français
 */
@Path("/api/country")
@RolesAllowed("ADMIN")
public class CountryResource {

    private static final Logger LOG = Logger.getLogger(CountryResource.class);

    /**
     * Créer un nouveau pays
     */
    @POST
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response createCountry(@Valid CountryRequest request) {
        String code = request.code.trim().toUpperCase();
        String companyId = request.companyId.trim().toUpperCase();

        LOG.infof("Admin tente de créer un pays : code=%s, companyId=%s", code, companyId);

        Country existing = Country.<Country>find("code", code).firstResult();

        if (existing != null) {
            LOG.warnf("Création du pays rejetée : %s existe déjà avec companyId=%s",
                    code, existing.companyId);

            return Response.status(Response.Status.CONFLICT)
                    .entity(new ErrorResponse(
                            "PAYS_EXISTE",
                            String.format("Le pays '%s' existe déjà", code),
                            Instant.now()
                    ))
                    .build();
        }

        Country country = new Country();
        country.code = code;
        country.companyId = companyId;
        country.persist();

        LOG.infof("Pays créé avec succès : code=%s, companyId=%s", code, companyId);

        return Response.status(Response.Status.CREATED)
                .entity(new CountryResponse(country))
                .build();
    }

    /**
     * Récupérer un pays par code
     */
    @GET
    @Path("/{code}")
    @Produces(MediaType.APPLICATION_JSON)
    public Response getCountryByCode(@PathParam("code") String code) {
        String normalizedCode = code.trim().toUpperCase();

        LOG.debugf("Récupération du pays : %s", normalizedCode);

        Country country = Country.<Country>find("code", normalizedCode).firstResult();

        if (country == null) {
            LOG.debugf("Pays non trouvé : %s", normalizedCode);

            return Response.status(Response.Status.NOT_FOUND)
                    .entity(new ErrorResponse(
                            "PAYS_NON_TROUVE",
                            String.format("Le pays '%s' n'a pas été trouvé", normalizedCode),
                            Instant.now()
                    ))
                    .build();
        }

        return Response.ok(new CountryResponse(country)).build();
    }

    /**
     * Lister tous les pays
     */
    @GET
    @Path("/list")
    @Produces(MediaType.APPLICATION_JSON)
    public Response listCountries() {
        LOG.debugf("Récupération de tous les pays");

        List<Country> countries = Country.listAll(Sort.by("code").ascending());

        List<CountryResponse> response = countries.stream()
                .map(CountryResponse::new)
                .toList();

        LOG.debugf("Retour de %d pays", response.size());

        return Response.ok(response).build();
    }

    /**
     * Supprimer un pays
     */
    @DELETE
    @Path("/{code}")
    @Produces(MediaType.APPLICATION_JSON)
    public Response deleteCountry(@PathParam("code") String code) {
        String normalizedCode = code.trim().toUpperCase();

        LOG.infof("Admin tente de supprimer le pays : %s", normalizedCode);

        Country country = Country.<Country>find("code", normalizedCode).firstResult();

        if (country == null) {
            LOG.warnf("Suppression échouée : Pays non trouvé : %s", normalizedCode);

            return Response.status(Response.Status.NOT_FOUND)
                    .entity(new ErrorResponse(
                            "PAYS_NON_TROUVE",
                            String.format("Le pays '%s' n'a pas été trouvé", normalizedCode),
                            Instant.now()
                    ))
                    .build();
        }

        // Vérifier si le pays est utilisé avant de le supprimer
        long usageCount = checkCountryUsage(normalizedCode);

        if (usageCount > 0) {
            LOG.warnf("Suppression rejetée : Le pays %s est utilisé par %d utilisateur(s)",
                    normalizedCode, usageCount);

            return Response.status(Response.Status.CONFLICT)
                    .entity(new ErrorResponse(
                            "PAYS_UTILISE",
                            String.format("Impossible de supprimer : Le pays '%s' est utilisé par %d utilisateur(s)",
                                    normalizedCode, usageCount),
                            Instant.now()
                    ))
                    .build();
        }

        country.delete();

        LOG.infof("Pays supprimé avec succès : %s", normalizedCode);

        return Response.ok(Map.of(
                "deleted", true,
                "code", normalizedCode,
                "timestamp", Instant.now()
        )).build();
    }

    /**
     * Vérifier si le pays est utilisé par des utilisateurs
     */
    private long checkCountryUsage(String countryCode) {
        try {
            return com.transact.processor.model.AppUser.count("countryCode", countryCode);
        } catch (Exception e) {
            LOG.debugf("Impossible de vérifier l'utilisation du pays : %s", e.getMessage());
            return 0;
        }
    }

    // ========================================
    // DTOs
    // ========================================

    public static class CountryRequest {
        @NotBlank(message = "Le code pays est requis")
        @Size(min = 2, max = 2, message = "Le code pays doit contenir exactement 2 caractères (ISO 3166-1 alpha-2)")
        @Pattern(regexp = "[A-Z]{2}", message = "Le code pays doit contenir 2 lettres majuscules (ex: FR, GB, US)")
        public String code;

        @NotBlank(message = "Le Company ID est requis")
        @Size(min = 3, max = 50, message = "Le Company ID doit contenir entre 3 et 50 caractères")
        public String companyId;
    }

    public static record CountryResponse(
            String code,
            String companyId
    ) {
        public CountryResponse(Country country) {
            this(country.code, country.companyId);
        }
    }

    public static record ErrorResponse(
            String code,
            String message,
            Instant timestamp
    ) {}
}