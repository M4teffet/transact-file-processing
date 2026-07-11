package com.transact;

import com.transact.processor.model.VirementSalaireConfig;
import io.quarkus.mongodb.panache.PanacheMongoEntity;
import io.quarkus.mongodb.panache.common.MongoEntity;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;

/**
 * Global VIREMENT_SALAIRE settings — single document, fully DB-driven
 * (no application.properties). Created with sensible defaults on first access.
 * <p>
 * Per-company transit accounts live in {@link VirementSalaireConfig};
 * everything else (fees, currency, bank, prefixes, routing) lives here.
 */
@MongoEntity(collection = "virement_salaire_settings")
public class VirementSalaireSettings extends PanacheMongoEntity {

    public String billingDefaultMode = "NONE";        // NONE | FLAT | STANDARD
    public BigDecimal flatFeeDefault = BigDecimal.ZERO;
    public BigDecimal perTransactionFee = BigDecimal.ZERO; // Y (STANDARD mode)
    public String currency = "XOF";
    public String orderingBank = "OBA";
    public String ftTransactionType = "AC";
    public String commissionCode = "DEBIT PLUS CHARGES";
    public String snCountryCode = "SN";               // country routed to sicaTransferSn
    public int maxThreads = 2;
    public Map<String, String> internalPrefixes = defaultPrefixes(); // country -> internal prefix
    public Instant updatedAt = Instant.now();

    private static Map<String, String> defaultPrefixes() {
        Map<String, String> m = new HashMap<>();
        m.put("CI", "CI214");
        m.put("SN", "SN305");
        return m;
    }

    /**
     * The single settings document, created with defaults on first access.
     */
    public static VirementSalaireSettings get() {
        VirementSalaireSettings s = findAll().firstResult();
        if (s == null) {
            s = new VirementSalaireSettings();
            s.persist();
        }
        return s;
    }

    public String internalPrefixFor(String country) {
        if (country == null || internalPrefixes == null) return null;
        String p = internalPrefixes.get(country);
        return (p != null && !p.isBlank()) ? p.trim() : null;
    }
}
