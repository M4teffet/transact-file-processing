package com.transact;

import com.transact.processor.model.Country;
import com.transact.processor.model.VirementSalaireConfig;
import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * Admin management of VIREMENT_SALAIRE per-company settings (payroll transit account).
 * The GET lists every configured country/company with its current transit account
 * (from DB, or the config-property fallback) so an admin can see what still needs setup.
 */
@Path("/api/v1/virsal-config")
@RolesAllowed("ADMIN")
public class VirementSalaireConfigResource {

    @Inject
    org.eclipse.microprofile.config.Config config;

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public Response list() {
        List<Row> rows = new ArrayList<>();
        for (Country c : Country.<Country>listAll()) {
            String dbAcct = VirementSalaireConfig.transitAccountFor(c.companyId);
            String fallback = config.getOptionalValue("virsal.transit-account." + c.companyId, String.class)
                    .orElse(null);
            rows.add(new Row(c.code, c.companyId, dbAcct != null ? dbAcct : fallback,
                    dbAcct != null ? "DB" : (fallback != null ? "CONFIG" : "NONE")));
        }
        return Response.ok(rows).build();
    }

    @PUT
    @Path("/{companyId}")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response set(@PathParam("companyId") String companyId, SetRequest request) {
        if (companyId == null || companyId.isBlank())
            return Response.status(400).entity("{\"message\":\"companyId requis\"}").build();
        if (request == null || request.transitAccount == null || request.transitAccount.isBlank())
            return Response.status(400).entity("{\"message\":\"transitAccount requis\"}").build();

        VirementSalaireConfig cfg = VirementSalaireConfig.findByCompany(companyId);
        if (cfg == null) {
            cfg = new VirementSalaireConfig();
            cfg.companyId = companyId;
        }
        cfg.transitAccount = request.transitAccount.trim();
        cfg.updatedAt = Instant.now();
        cfg.persistOrUpdate();

        return Response.ok(new Row(null, companyId, cfg.transitAccount, "DB")).build();
    }

    public record Row(String code, String companyId, String transitAccount, String source) {
    }

    public static class SetRequest {
        public String transitAccount;
    }
}
