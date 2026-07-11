package com.transact;

import com.transact.processor.model.Country;
import com.transact.processor.model.VirementSalaireConfig;
import com.transact.processor.model.VirementSalaireSettings;
import jakarta.annotation.security.RolesAllowed;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Admin management of VIREMENT_SALAIRE configuration — fully DB-driven.
 * <ul>
 *   <li>{@code /api/v1/virsal-config}          — per-company transit accounts (GET list, PUT set)</li>
 *   <li>{@code /api/v1/virsal-config/settings} — global settings (GET, PUT)</li>
 * </ul>
 */
@Path("/api/v1/virsal-config")
@RolesAllowed("ADMIN")
public class VirementSalaireConfigResource {

    // ── Per-company transit accounts ────────────────────────────────────────

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    public Response listTransit() {
        List<TransitRow> rows = new ArrayList<>();
        for (Country c : Country.<Country>listAll()) {
            String acct = VirementSalaireConfig.transitAccountFor(c.companyId);
            rows.add(new TransitRow(c.code, c.companyId, acct, acct != null ? "DB" : "NONE"));
        }
        return Response.ok(rows).build();
    }

    @PUT
    @Path("/{companyId}")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response setTransit(@PathParam("companyId") String companyId, SetTransitRequest request) {
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
        return Response.ok(new TransitRow(null, companyId, cfg.transitAccount, "DB")).build();
    }

    // ── Global settings ─────────────────────────────────────────────────────

    @GET
    @Path("/settings")
    @Produces(MediaType.APPLICATION_JSON)
    public Response getSettings() {
        return Response.ok(VirementSalaireSettings.get()).build();
    }

    @PUT
    @Path("/settings")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    public Response updateSettings(SettingsRequest r) {
        VirementSalaireSettings s = VirementSalaireSettings.get();
        if (r != null) {
            if (r.billingDefaultMode != null) s.billingDefaultMode = r.billingDefaultMode.trim().toUpperCase();
            if (r.flatFeeDefault != null) s.flatFeeDefault = r.flatFeeDefault;
            if (r.perTransactionFee != null) s.perTransactionFee = r.perTransactionFee;
            if (r.currency != null) s.currency = r.currency.trim();
            if (r.orderingBank != null) s.orderingBank = r.orderingBank.trim();
            if (r.ftTransactionType != null) s.ftTransactionType = r.ftTransactionType.trim();
            if (r.commissionCode != null) s.commissionCode = r.commissionCode.trim();
            if (r.snCountryCode != null) s.snCountryCode = r.snCountryCode.trim().toUpperCase();
            if (r.maxThreads != null && r.maxThreads > 0) s.maxThreads = r.maxThreads;
            if (r.requestIdMaxLength != null && r.requestIdMaxLength > 0) s.requestIdMaxLength = r.requestIdMaxLength;
            if (r.internalPrefixes != null) s.internalPrefixes = r.internalPrefixes;
        }
        s.updatedAt = Instant.now();
        s.persistOrUpdate();
        return Response.ok(s).build();
    }

    // ── DTOs ────────────────────────────────────────────────────────────────

    public record TransitRow(String code, String companyId, String transitAccount, String source) {
    }

    public static class SetTransitRequest {
        public String transitAccount;
    }

    public static class SettingsRequest {
        public String billingDefaultMode;
        public BigDecimal flatFeeDefault;
        public BigDecimal perTransactionFee;
        public String currency;
        public String orderingBank;
        public String ftTransactionType;
        public String commissionCode;
        public String snCountryCode;
        public Integer maxThreads;
        public Integer requestIdMaxLength;
        public Map<String, String> internalPrefixes;
    }
}
