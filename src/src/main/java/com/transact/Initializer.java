package com.transact;

import com.mongodb.client.MongoClient;
import com.mongodb.client.model.*;
import com.transact.processor.model.*;
import com.transact.service.PasswordService;
import io.quarkus.runtime.StartupEvent;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

import java.util.ArrayList;
import java.util.List;

@ApplicationScoped
public class Initializer {

    private static final Logger LOG = Logger.getLogger(Initializer.class);

    private static final String DEFAULT_COUNTRY_CODE = "CI";
    private static final String DEFAULT_COMPANY_ID = "CI2250001";
    private static final String ADMIN_USERNAME = "ADMIN";
    private static final Integer DEFAULT_DEPARTMENT_ID = 101;
    private static final String DEFAULT_DEPARTMENT_DESC = "Administration";
    private static final String FEAT_FT = "FUNDS_TRANSFER";
    private static final String FEAT_FT_REV = "FUNDS_TRANSFER_REVERSAL";
    private static final String FEAT_SICA = "SICA_TRANSFER";
    private static final String FEAT_VIRSAL = "VIREMENT_SALAIRE";

    @Inject
    PasswordService passwordService;

    @Inject
    MongoClient mongoClient;

    @ConfigProperty(name = "quarkus.mongodb.database", defaultValue = "transactdb")
    String dbName;

    @ConfigProperty(name = "app.admin.initial-password", defaultValue = "Admin@12345!")
    String initialAdminPassword;

    void onStart(@Observes StartupEvent event) {
        LOG.info("=== Initializer starting ===");
        ensureIdempotencyIndex();
        initializePasswordPolicy();
        migrateApplicationRequiredFields();
        initializeCountry();
        initializeDepartment();
        initializeAdminUser();
        initializeFeatures();
        initializeApplications();
        LOG.info("=== Initializer complete ===");
    }

    void ensureIdempotencyIndex() {
        try {
            var coll = mongoClient.getDatabase(dbName).getCollection("idempotency_keys");
            // Unique index on key for fast lookup + dedup
            coll.createIndex(Indexes.ascending("key"),
                    new IndexOptions().unique(true).background(true));
            // TTL index — MongoDB auto-deletes documents when expireAt < now
            coll.createIndex(Indexes.ascending("expireAt"),
                    new IndexOptions().expireAfter(0L, java.util.concurrent.TimeUnit.SECONDS));
            LOG.info("Index idempotency_keys: OK");
        } catch (Exception e) {
            LOG.warnf("Impossible de créer les index idempotency_keys: %s", e.getMessage());
        }
    }

    /**
     * One-time migration: existing Application documents were created before
     * isRequired was properly written. All fields have isRequired=null → false.
     * <p>
     * Uses native MongoDB arrayFilters to set isRequired on specific elements
     * inside the schema array without touching the rest of the document —
     * safe to run on every startup because the values are idempotent after the
     * first run.
     */
    void migrateApplicationRequiredFields() {
        try {
            var coll = Application.mongoCollection();
            var opts = new UpdateOptions();

            // ── FUNDS_TRANSFER ────────────────────────────────────────────────
            var ft = Application.findByName("FUNDS_TRANSFER");
            if (ft != null) {
                var mandatory = List.of("TRANSACTION.TYPE", "DEBIT.ACCT.NO", "CREDIT.ACCT.NO");

                // Set isRequired=true for the three mandatory fields
                coll.updateOne(
                        Filters.eq("_id", ft.id),
                        Updates.set("schema.$[elem].isRequired", true),
                        opts.arrayFilters(List.of(
                                Filters.in("elem.fieldName", mandatory)
                        ))
                );

                // Set isRequired=false for every other field still null
                coll.updateOne(
                        Filters.eq("_id", ft.id),
                        Updates.set("schema.$[elem].isRequired", false),
                        opts.arrayFilters(List.of(
                                Filters.and(
                                        Filters.nin("elem.fieldName", mandatory),
                                        Filters.eq("elem.isRequired", null)
                                )
                        ))
                );

                LOG.infof("[Migration] FUNDS_TRANSFER: %d champs obligatoires marqués", mandatory.size());
            }

            // ── FUNDS_TRANSFER_REVERSAL ───────────────────────────────────────
            var ftr = Application.findByName("FUNDS_TRANSFER_REVERSAL");
            if (ftr != null) {
                coll.updateOne(
                        Filters.eq("_id", ftr.id),
                        Updates.set("schema.$[elem].isRequired", false),
                        opts.arrayFilters(List.of(
                                Filters.eq("elem.isRequired", null)
                        ))
                );

                LOG.info("[Migration] FUNDS_TRANSFER_REVERSAL: champs optionnels normalisés");
            }

        } catch (Exception e) {
            LOG.warnf("[Migration] migrateApplicationRequiredFields: %s", e.getMessage());
        }
    }

    void initializePasswordPolicy() {
        try {
            if (PasswordPolicyEntity.count() == 0) {
                var policy = new PasswordPolicyEntity();
                // Defaults: minLength=10, all flags true (matching the old @ConfigProperty defaults)
                policy.persist();
                LOG.info("[Policy] Document de politique initialisé avec les valeurs par défaut");
            }
        } catch (Exception e) {
            LOG.warnf("[Policy] Impossible d'initialiser la politique : %s", e.getMessage());
        }
    }

    void initializeAdminUser() {
        try {
            if (AppUser.findByUsername(ADMIN_USERNAME).isPresent()) return;

            AppUser admin = new AppUser();
            admin.username = ADMIN_USERNAME;
            admin.setPasswordHash(passwordService.hashRaw(initialAdminPassword));
            admin.setRole(AppUser.UserRole.ADMIN);
            admin.countryCode = DEFAULT_COUNTRY_CODE;
            admin.department = DEFAULT_DEPARTMENT_ID;
            admin.mustChangePassword = true;   // Force change on first login
            admin.status = AppUser.UserStatus.ACTIVE;
            admin.createdBy = "SYSTEM";
            admin.persist();

            LOG.infof("Admin user created: %s", ADMIN_USERNAME);
            LOG.warn("⚠  CHANGE THE ADMIN PASSWORD ON FIRST LOGIN!");
        } catch (Exception e) {
            LOG.errorf(e, "Failed to create admin user: %s", e.getMessage());
            throw new RuntimeException("FATAL: could not seed admin user — application cannot start safely", e);
        }
    }

    void initializeDepartment() {
        try {
            if (Departments.find("code", DEFAULT_DEPARTMENT_ID).count() == 0) {
                Departments d = new Departments();
                d.code = DEFAULT_DEPARTMENT_ID;
                d.description = DEFAULT_DEPARTMENT_DESC;
                d.persist();
                LOG.infof("Department created: %d", DEFAULT_DEPARTMENT_ID);
            }
        } catch (Exception e) {
            LOG.errorf("Failed to create department: %s", e.getMessage());
        }
    }

    void initializeCountry() {
        try {
            if (Country.find("code", DEFAULT_COUNTRY_CODE).count() == 0) {
                Country c = new Country();
                c.code = DEFAULT_COUNTRY_CODE;
                c.companyId = DEFAULT_COMPANY_ID;
                c.persist();
                LOG.infof("Country created: %s", DEFAULT_COUNTRY_CODE);
            }
        } catch (Exception e) {
            LOG.errorf("Failed to create country: %s", e.getMessage());
        }
    }

    void initializeFeatures() {
        for (String key : List.of(FEAT_FT, FEAT_FT_REV, FEAT_SICA, FEAT_VIRSAL)) {
            try {
                if (AppFeatureConfig.findByName(key).isEmpty()) {
                    AppFeatureConfig conf = new AppFeatureConfig();
                    conf.configKey = key;
                    conf.description = key.replace("_", " ").toLowerCase();
                    conf.isEnabled = false;
                    conf.persist();
                    LOG.infof("Feature created: %s", key);
                }
            } catch (Exception e) {
                LOG.errorf("Failed to create feature %s: %s", key, e.getMessage());
            }
        }
    }

    void initializeApplications() {
        initFundsTransferApp();
        initFundsTransferReversalApp();
        initSicaApp();
        initVirementSalaireApp();
    }

    private void initVirementSalaireApp() {
        try {
            if (Application.findByName(FEAT_VIRSAL) != null) return;

            Application app = new Application();
            app.name = FEAT_VIRSAL;
            app.description = "Virement de salaires en masse (payroll) — compte de transit + FT/SICA";

            // Columns from the CSV header (DEBIT account comes from the FILE NAME, not a column).
            List<SchemaField> fields = new ArrayList<>();
            fields.add(new SchemaField("L.BEN.ACC.NO", "Beneficiary Account", "STRING", true, "L.BEN.ACC.NO"));
            fields.add(new SchemaField("L.BEN.NAME", "Beneficiary Name", "STRING", true, "L.BEN.NAME"));
            fields.add(new SchemaField("L.BEN.ADDR", "Beneficiary Address", "STRING", true, "L.BEN.ADDR"));
            fields.add(new SchemaField("CREDIT.AMOUNT", "Credit Amount (net)", "DECIMAL", true, "CREDIT.AMOUNT"));
            fields.add(new SchemaField("PAYMENT.DETAILS", "Payment Details", "STRING", true, "PAYMENT.DETAILS"));
            fields.add(new SchemaField("L.FT.MOTIF.ECO", "Economic Motive / Object", "STRING", false, "L.FT.MOTIF.ECO"));
            fields.add(new SchemaField("L.MAPP.REQ.ID", "Request ID (auto-generated)", "STRING", false, "L.MAPP.REQ.ID"));

            app.setSchema(fields);
            app.persist();
            LOG.infof("Application created: %s (%d fields)", FEAT_VIRSAL, fields.size());
        } catch (Exception e) {
            LOG.errorf("Failed to init application %s: %s", FEAT_VIRSAL, e.getMessage());
        }
    }

    private void initFundsTransferApp() {
        try {
            if (Application.findByName(FEAT_FT) != null) return;

            Application app = new Application();
            app.name = FEAT_FT;
            app.description = "Funds transfer module";

            List<SchemaField> fields = new ArrayList<>();
            fields.add(new SchemaField("TRANSACTION.TYPE", "Transaction Type", "STRING", true, "TRANSACTION.TYPE"));
            fields.add(new SchemaField("DEBIT.ACCT.NO", "Debit Account Number", "STRING", true, "DEBIT.ACCT.NO"));
            fields.add(new SchemaField("CREDIT.ACCT.NO", "Credit Account Number", "STRING", true, "CREDIT.ACCT.NO"));
            fields.add(new SchemaField("DEBIT.AMOUNT", "Debit Amount", "DECIMAL", false, "DEBIT.AMOUNT"));
            fields.add(new SchemaField("DEBIT.CURRENCY", "Debit Currency", "STRING", false, "DEBIT.CURRENCY"));
            fields.add(new SchemaField("CREDIT.AMOUNT", "Credit Amount", "DECIMAL", false, "CREDIT.AMOUNT"));
            fields.add(new SchemaField("CREDIT.CURRENCY", "Credit Currency", "STRING", false, "CREDIT.CURRENCY"));
            fields.add(new SchemaField("DEBIT.VALUE.DATE", "Debit Value Date", "DATE", false, "DEBIT.VALUE.DATE"));
            fields.add(new SchemaField("CREDIT.VALUE.DATE", "Credit Value Date", "DATE", false, "CREDIT.VALUE.DATE"));
            fields.add(new SchemaField("PAYMENT.DETAILS", "Payment Details", "STRING", false, "PAYMENT.DETAILS"));
            fields.add(new SchemaField("ORDERING.BANK", "Ordering Bank", "STRING", false, "ORDERING.BANK"));
            fields.add(new SchemaField("ORDERING.CUST", "Ordering Customer", "STRING", false, "ORDERING.CUST"));
            fields.add(new SchemaField("PROCESSING.DATE", "Processing Date", "DATE", false, "PROCESSING.DATE"));
            fields.add(new SchemaField("DEBIT.THEIR.REF", "Debit Their Reference", "STRING", false, "DEBIT.THEIR.REF"));
            fields.add(new SchemaField("CREDIT.THEIR.REF", "Credit Their Reference", "STRING", false, "CREDIT.THEIR.REF"));
            fields.add(new SchemaField("COMMISSION.CODE", "Commission Code", "STRING", false, "COMMISSION.CODE"));
            fields.add(new SchemaField("COMMISSION.AMT", "Commission Amount", "DECIMAL", false, "COMMISSION.AMT"));
            fields.add(new SchemaField("CHARGE.CODE", "Charge Code", "STRING", false, "CHARGE.CODE"));
            fields.add(new SchemaField("CHARGE.AMT", "Charge Amount", "DECIMAL", false, "CHARGE.AMT"));
            fields.add(new SchemaField("PROFIT.CENTRE.CUST", "Profit Centre Customer", "STRING", false, "PROFIT.CENTRE.CUST"));
            fields.add(new SchemaField("PROFIT.CENTRE.DEPT", "Profit Centre Department", "STRING", false, "PROFIT.CENTRE.DEPT"));
            fields.add(new SchemaField("EXPOSURE.DATE", "Exposure Date", "DATE", false, "EXPOSURE.DATE"));
            fields.add(new SchemaField("@ID", "Transaction ID", "STRING", false, "@ID"));

            app.setSchema(fields);
            app.persist();
            LOG.infof("Application created: %s (%d fields)", FEAT_FT, fields.size());
        } catch (Exception e) {
            LOG.errorf("Failed to init application %s: %s", FEAT_FT, e.getMessage());
        }
    }

    private void initSicaApp() {
        try {
            if (Application.findByName(FEAT_SICA) != null) return;

            Application app = new Application();
            app.name = FEAT_SICA;
            app.description = "SICA interbank / confrère transfer (UEMOA gateway)";

            List<SchemaField> fields = new ArrayList<>();
            fields.add(new SchemaField("DEBIT.ACCT.NO", "Debit Account Number", "STRING", true, "DEBIT.ACCT.NO"));
            fields.add(new SchemaField("DEBIT.AMOUNT", "Transaction Amount", "DECIMAL", true, "DEBIT.AMOUNT"));
            fields.add(new SchemaField("DEBIT.VALUE.DATE", "Debit Value Date", "DATE", false, "DEBIT.VALUE.DATE"));
            fields.add(new SchemaField("L.BANK.CODE", "Beneficiary Bank Code", "STRING", true, "L.BANK.CODE"));
            fields.add(new SchemaField("L.BEN.ACC.NO", "Beneficiary Account / IBAN", "STRING", true, "L.BEN.ACC.NO"));
            fields.add(new SchemaField("L.BEN.NAME", "Beneficiary Name", "STRING", true, "L.BEN.NAME"));
            fields.add(new SchemaField("L.BEN.ADDR", "Beneficiary Address", "STRING", true, "L.BEN.ADDR"));
            fields.add(new SchemaField("CREDIT.VALUE.DATE", "Credit Value Date", "DATE", false, "CREDIT.VALUE.DATE"));
            fields.add(new SchemaField("PAYMENT.DETAILS", "Payment Details", "STRING", true, "PAYMENT.DETAILS"));
            fields.add(new SchemaField("L.FT.MOTIF.ECO", "Economic Motive / Object", "STRING", true, "L.FT.MOTIF.ECO"));
            fields.add(new SchemaField("L.MAPP.REQ.ID", "Request ID (idempotency key)", "STRING", true, "L.MAPP.REQ.ID"));
            fields.add(new SchemaField("COMMISSION.CODE", "Commission Code", "STRING", false, "COMMISSION.CODE"));
            fields.add(new SchemaField("COMMISSION.AMT", "Commission Amount", "DECIMAL", false, "COMMISSION.AMT"));
            fields.add(new SchemaField("L.TXN.REF", "Transaction Reference", "STRING", false, "L.TXN.REF"));

            app.setSchema(fields);
            app.persist();
            LOG.infof("Application created: %s (%d fields)", FEAT_SICA, fields.size());
        } catch (Exception e) {
            LOG.errorf("Failed to init application %s: %s", FEAT_SICA, e.getMessage());
        }
    }

    private void initFundsTransferReversalApp() {
        try {
            if (Application.findByName(FEAT_FT_REV) != null) return;

            Application app = new Application();
            app.name = FEAT_FT_REV;
            app.description = "Funds transfer reversal by T24 reference";

            List<SchemaField> fields = new ArrayList<>();
            fields.add(new SchemaField("TRANSACTION.ID", "T24 reference to reverse", "STRING", true, "TRANSACTION.ID"));

            app.setSchema(fields);
            app.persist();
            LOG.infof("Application created: %s", FEAT_FT_REV);
        } catch (Exception e) {
            LOG.errorf("Failed to init application %s: %s", FEAT_FT_REV, e.getMessage());
        }
    }
}