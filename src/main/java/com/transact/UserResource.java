package com.transact;

import com.transact.processor.model.AppUser;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;
import org.jboss.resteasy.reactive.RestForm;

import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * UserResource - VERSION FRANÇAISE
 * <p>
 * ✅ Tous les messages et logs en français
 * ✅ Validation améliorée
 * ✅ Gestion d'erreurs structurée
 */
@Path("/api/users")
@RolesAllowed("ADMIN")
public class UserResource {

    private static final Logger LOG = Logger.getLogger(UserResource.class);
    private static final Set<String> VALID_ROLES = Set.of("INPUTTER", "ADMIN", "AUTHORISER");
    @Inject
    SecurityIdentity identity;

    /**
     * Lister tous les utilisateurs
     */
    @GET
    @Path("/list")
    @Produces(MediaType.APPLICATION_JSON)
    public Response findAll() {
        String adminUsername = identity.getPrincipal().getName();

        try {
            LOG.debugf("Admin %s demande la liste des utilisateurs", adminUsername);

            List<UserViewDTO> users = AppUser.<AppUser>listAll().stream()
                    .map(u -> new UserViewDTO(
                            u.getUsername(),
                            u.countryCode,
                            u.getRole().toString(),
                            u.getDepartment()
                    ))
                    .collect(Collectors.toList());

            LOG.infof("Retour de %d utilisateurs à l'admin %s", users.size(), adminUsername);

            return Response.ok(users).build();

        } catch (Exception e) {
            LOG.errorf(e, "Échec de récupération de la liste des utilisateurs pour l'admin : %s",
                    adminUsername);
            return Response.status(Response.Status.INTERNAL_SERVER_ERROR)
                    .entity(new ErrorResponse(
                            "ERREUR_SERVEUR",
                            "Erreur lors de la récupération de la liste des utilisateurs",
                            Instant.now()
                    ))
                    .build();
        }
    }

    /**
     * Créer un nouvel utilisateur
     */
    @POST
    @Produces(MediaType.APPLICATION_JSON)
    @Consumes(MediaType.APPLICATION_FORM_URLENCODED)
    public Response addUser(
            @RestForm @NotBlank String username,
            @RestForm @NotBlank String password,
            @RestForm @NotBlank String role,
            @RestForm @NotBlank String country,
            @RestForm @NotNull Integer department) {

        String adminUsername = identity.getPrincipal().getName();

        try {
            // Sanitisation et normalisation des entrées
            username = username.trim().toUpperCase();
            role = role.trim().toUpperCase();
            country = country.trim().toUpperCase();

            LOG.infof("Admin %s tente de créer l'utilisateur : %s (rôle: %s, pays: %s, dép: %d)",
                    adminUsername, username, role, country, department);

            // Validation des champs requis
            if (username.isEmpty() || password.isEmpty() || role.isEmpty() || country.isEmpty()) {
                LOG.warnf("Création d'utilisateur échouée : champs requis manquants (admin: %s)",
                        adminUsername);
                return Response.status(Response.Status.BAD_REQUEST)
                        .entity(new ErrorResponse(
                                "CHAMPS_REQUIS",
                                "Le nom d'utilisateur, le mot de passe, le rôle et le pays sont requis",
                                Instant.now()
                        ))
                        .build();
            }

            // Validation du rôle
            if (!VALID_ROLES.contains(role)) {
                LOG.warnf("Rôle invalide fourni : %s par l'admin : %s", role, adminUsername);
                return Response.status(Response.Status.BAD_REQUEST)
                        .entity(new ErrorResponse(
                                "ROLE_INVALIDE",
                                "Rôle invalide : " + role + ". Valeurs autorisées : " + VALID_ROLES,
                                Instant.now()
                        ))
                        .build();
            }

            // Validation du département
            if (department <= 0) {
                LOG.warnf("ID de département invalide : %d (admin: %s)", department, adminUsername);
                return Response.status(Response.Status.BAD_REQUEST)
                        .entity(new ErrorResponse(
                                "DEPARTEMENT_INVALIDE",
                                "Le département doit être un nombre positif",
                                Instant.now()
                        ))
                        .build();
            }

            // Vérification de l'unicité du nom d'utilisateur
            if (AppUser.findByUsername(username).isPresent()) {
                LOG.warnf("Tentative de création d'un utilisateur en double : %s (admin: %s)",
                        username, adminUsername);
                return Response.status(Response.Status.CONFLICT)
                        .entity(new ErrorResponse(
                                "UTILISATEUR_EXISTE",
                                "Le nom d'utilisateur '" + username + "' existe déjà",
                                Instant.now()
                        ))
                        .build();
            }

            // Création de l'utilisateur
            AppUser user = AppUser.add(username, password, role, country, department);

            LOG.infof("Utilisateur créé avec succès : %s par l'admin : %s", username, adminUsername);

            // DTO pour le rendu immédiat de l'interface
            UserViewDTO dto = new UserViewDTO(
                    user.getUsername(),
                    user.countryCode,
                    user.getRole().toString(),
                    user.getDepartment()
            );

            return Response.status(Response.Status.CREATED)
                    .entity(dto)
                    .build();

        } catch (IllegalArgumentException e) {
            // Erreurs de validation métier
            LOG.warnf("Validation métier échouée pour l'utilisateur %s par l'admin %s : %s",
                    username, adminUsername, e.getMessage());
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity(new ErrorResponse(
                            "ERREUR_VALIDATION",
                            e.getMessage(),
                            Instant.now()
                    ))
                    .build();

        } catch (Exception e) {
            // Erreurs inattendues
            LOG.errorf(e, "Échec de création de l'utilisateur : %s par l'admin : %s",
                    username, adminUsername);
            return Response.status(Response.Status.INTERNAL_SERVER_ERROR)
                    .entity(new ErrorResponse(
                            "ERREUR_SERVEUR",
                            "Échec de création de l'utilisateur. Veuillez contacter le support.",
                            Instant.now()
                    ))
                    .build();
        }
    }

    // ========================================
    // DTOs
    // ========================================

    public record UserViewDTO(
            String username,
            String countryCode,
            String role,
            Integer department
    ) {
    }

    public record ErrorResponse(
            String code,
            String message,
            Instant timestamp
    ) {
    }
}