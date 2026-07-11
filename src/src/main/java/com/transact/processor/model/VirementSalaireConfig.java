package com.transact.processor.model;

import io.quarkus.mongodb.panache.PanacheMongoEntity;
import io.quarkus.mongodb.panache.common.MongoEntity;

import java.time.Instant;

/**
 * Per-company VIREMENT_SALAIRE configuration (admin-managed).
 * Currently holds the payroll transit account; the processor reads this first
 * and falls back to the {@code virsal.transit-account.<companyId>} property.
 */
@MongoEntity(collection = "virement_salaire_config")
public class VirementSalaireConfig extends PanacheMongoEntity {

    public String companyId;
    public String transitAccount;
    public Instant updatedAt = Instant.now();

    public static VirementSalaireConfig findByCompany(String companyId) {
        if (companyId == null) return null;
        return find("companyId", companyId).firstResult();
    }

    /** Transit account for a company, or null if not set in the DB. */
    public static String transitAccountFor(String companyId) {
        VirementSalaireConfig c = findByCompany(companyId);
        return (c != null && c.transitAccount != null && !c.transitAccount.isBlank())
                ? c.transitAccount.trim() : null;
    }
}
