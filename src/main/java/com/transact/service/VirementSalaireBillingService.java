package com.transact.service;

import com.transact.processor.model.BatchData;
import com.transact.processor.model.VirementSalaireSettings;
import io.quarkus.runtime.annotations.RegisterForReflection;
import jakarta.enterprise.context.ApplicationScoped;
import org.bson.types.ObjectId;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Single source of truth for VIREMENT_SALAIRE charge computation.
 * Fully DB-driven: fees / default mode / prefixes come from
 * {@link VirementSalaireSettings} (no application.properties).
 * <ul>
 *   <li>{@code Z} = Σ CREDIT.AMOUNT (net payroll)</li>
 *   <li>{@code X} = number of external beneficiaries (L.BEN.ACC.NO not starting with the country prefix)</li>
 *   <li>NONE → A = Z ; FLAT → A = Z + flatFee ; STANDARD → A = Z + (X × perTxnFee)</li>
 * </ul>
 */
@ApplicationScoped
public class VirementSalaireBillingService {

    public static final Set<String> MODES = Set.of("NONE", "FLAT", "STANDARD");

    public String resolveMode(String mode) {
        if (mode == null || mode.isBlank()) {
            String def = VirementSalaireSettings.get().billingDefaultMode;
            return (def == null || def.isBlank()) ? "NONE" : def.trim().toUpperCase();
        }
        return mode.trim().toUpperCase();
    }

    public BigDecimal resolveFlatFee(BigDecimal flatFee) {
        if (flatFee != null) return flatFee;
        BigDecimal def = VirementSalaireSettings.get().flatFeeDefault;
        return def != null ? def : BigDecimal.ZERO;
    }

    public String internalPrefixFor(String countryCode) {
        return VirementSalaireSettings.get().internalPrefixFor(countryCode);
    }

    /**
     * Compute totals for a batch (loads its rows).
     */
    public Billing computeForBatch(ObjectId batchId, String mode, BigDecimal flatFee, String countryCode) {
        return compute(BatchData.findByBatchId(batchId), resolveMode(mode), resolveFlatFee(flatFee),
                internalPrefixFor(countryCode));
    }

    public Billing compute(List<BatchData> rows, String mode, BigDecimal flatFee, String internalPrefix) {
        BigDecimal perTxnFee = VirementSalaireSettings.get().perTransactionFee;
        if (perTxnFee == null) perTxnFee = BigDecimal.ZERO;

        BigDecimal z = BigDecimal.ZERO;
        int external = 0;
        for (BatchData r : rows) {
            z = z.add(amount(r));
            if (isExternal(benAcct(r), internalPrefix)) external++;
        }
        String m = (mode == null) ? "NONE" : mode.toUpperCase();
        BigDecimal fees = switch (m) {
            case "FLAT" -> (flatFee != null) ? flatFee : BigDecimal.ZERO;
            case "STANDARD" -> perTxnFee.multiply(BigDecimal.valueOf(external));
            default -> BigDecimal.ZERO;
        };
        Billing b = new Billing();
        b.mode = m;
        b.totalRows = rows.size();
        b.externalCount = external;
        b.internalCount = rows.size() - external;
        b.netTotalZ = z;
        b.perTransactionFee = perTxnFee;
        b.flatFee = flatFee;
        b.feesTotal = fees;
        b.grandTotalA = z.add(fees);
        return b;
    }

    // ── shared helpers ───────────────────────────────────────────────────────
    public BigDecimal amount(BatchData row) {
        String v = str(row, "CREDIT.AMOUNT");
        if (v == null) return BigDecimal.ZERO;
        try {
            return new BigDecimal(v.replace(",", ""));
        } catch (Exception e) {
            return BigDecimal.ZERO;
        }
    }

    public String benAcct(BatchData row) {
        return str(row, "L.BEN.ACC.NO");
    }

    public boolean isExternal(String benAcct, String internalPrefix) {
        if (benAcct == null) return true;
        if (internalPrefix == null || internalPrefix.isBlank()) return true;
        return !benAcct.toUpperCase().startsWith(internalPrefix.toUpperCase());
    }

    private String str(BatchData row, String key) {
        if (row.data == null) return null;
        Object v = row.data.get(key);
        if (v == null) return null;
        String s = v.toString().trim();
        return s.isEmpty() ? null : s;
    }

    @RegisterForReflection
    public static class Billing {
        public String mode;
        public int totalRows;
        public int internalCount;
        public int externalCount;
        public BigDecimal netTotalZ;
        public BigDecimal perTransactionFee;
        public BigDecimal flatFee;
        public BigDecimal feesTotal;
        public BigDecimal grandTotalA;

        public Map<String, Object> toMap() {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("mode", mode);
            m.put("totalRows", totalRows);
            m.put("internalCount", internalCount);
            m.put("externalCount", externalCount);
            m.put("netTotalZ", netTotalZ);
            m.put("perTransactionFee", perTransactionFee);
            m.put("flatFee", flatFee);
            m.put("feesTotal", feesTotal);
            m.put("grandTotalA", grandTotalA);
            return m;
        }
    }
}
