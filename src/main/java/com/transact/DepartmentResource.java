package com.transact;

import com.transact.processor.model.AppUser;
import com.transact.processor.model.Departments;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.util.List;
import java.util.Map;

/**
 * DepartmentResource - VERSION FRANÇAISE
 * <p>
 * ✅ Tous les messages et logs en français
 */
@Path("/api/departments")
@RolesAllowed("ADMIN")
public class DepartmentResource {

    private static final Logger LOG = Logger.getLogger(DepartmentResource.class);

    @Inject
    SecurityIdentity identity;

    /**
     * Lister tous les départements
     */
    @GET
    @Path("/list")
    @Produces(MediaType.APPLICATION_JSON)
    public List<Departments> listDepartment() {
        return Departments.listAll();
    }

    /**
     * Créer un nouveau département
     */
    @POST
    @Produces(MediaType.APPLICATION_JSON)
    @Consumes(MediaType.APPLICATION_JSON)
    public Response createDepartment(@Valid DepartmentRequest request) {
        String adminUsername = identity.getPrincipal().getName();

        try {
            // Vérifier si le département existe déjà
            Departments existing = Departments.find("code", request.code).firstResult();
            if (existing != null) {
                LOG.warnf("Création du département échouée - existe déjà : %d (par %s)",
                        request.code, adminUsername);
                return Response.status(Response.Status.CONFLICT)
                        .entity(Map.of(
                                "message", "Le code département " + request.code + " existe déjà"
                        ))
                        .build();
            }

            Departments department = new Departments();
            department.code = request.code;
            department.description = request.description.trim();
            department.persist();

            LOG.infof("Département créé : %d - %s (par %s)",
                    department.code, department.description, adminUsername);

            return Response.status(Response.Status.CREATED)
                    .entity(department)
                    .build();

        } catch (Exception e) {
            LOG.errorf(e, "Échec de création du département");
            return Response.status(Response.Status.INTERNAL_SERVER_ERROR)
                    .entity(Map.of("message", "Échec de création du département"))
                    .build();
        }
    }

    /**
     * Supprimer un département
     */
    @DELETE
    @Path("/{code}")
    @Produces(MediaType.APPLICATION_JSON)
    public Response deleteDepartment(@PathParam("code") Integer code) {
        String adminUsername = identity.getPrincipal().getName();

        try {
            // 1. Vérifier si le département existe
            Departments department = Departments.find("code", code).firstResult();
            if (department == null) {
                return Response.status(Response.Status.NOT_FOUND)
                        .entity(Map.of("message", "Département non trouvé : " + code))
                        .build();
            }

            // 2. Vérifier si des utilisateurs sont assignés à ce département
            long userCount = AppUser.count("department", code);
            if (userCount > 0) {
                LOG.warnf("Suppression du département bloquée - %d utilisateur(s) assigné(s) au dép. %d (par %s)",
                        userCount, code, adminUsername);
                return Response.status(Response.Status.CONFLICT)
                        .entity(Map.of(
                                "message", String.format(
                                        "Impossible de supprimer le département %d : %d utilisateur(s) y sont assigné(s)",
                                        code, userCount
                                ),
                                "userCount", userCount
                        ))
                        .build();
            }

            // 3. Supprimer le département
            department.delete();

            LOG.infof("Département supprimé : %d - %s (par %s)",
                    code, department.description, adminUsername);

            return Response.ok(Map.of(
                    "message", "Département supprimé avec succès",
                    "code", code
            )).build();

        } catch (Exception e) {
            LOG.errorf(e, "Échec de suppression du département : %d", code);
            return Response.status(Response.Status.INTERNAL_SERVER_ERROR)
                    .entity(Map.of("message", "Échec de suppression du département"))
                    .build();
        }
    }

    // ========================================
    // DTO
    // ========================================

    public static class DepartmentRequest {
        @Positive(message = "Le code département doit être un nombre positif")
        public Integer code;

        @NotBlank(message = "La description est requise")
        public String description;
    }
}