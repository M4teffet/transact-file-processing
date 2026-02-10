package com.transact;

import com.transact.processor.model.*;
import io.quarkus.runtime.StartupEvent;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;
import org.mindrot.jbcrypt.BCrypt;

import java.util.ArrayList;
import java.util.List;

/**
 * Initializer - VERSION FRANÇAISE
 * <p>
 * ✅ Initialisation des Départements, Pays, Admin, Features
 * ✅ Initialisation des Applications (Schémas FUNDS_TRANSFER & REVERSAL)
 */
@ApplicationScoped
public class Initializer {

    private static final Logger LOG = Logger.getLogger(Initializer.class);

    // Constantes de base
    private static final String DEFAULT_COUNTRY_CODE = "CI";
    private static final String DEFAULT_COMPANY_ID = "CI2250001";
    private static final String ADMIN_USERNAME = "ADMIN";
    private static final Integer DEFAULT_DEPARTMENT_ID = 101;
    private static final String DEFAULT_DEPARTMENT_DESC = "Administration";
    // Constantes Features
    private static final String FEAT_FT = "FUNDS_TRANSFER";
    private static final String FEAT_FT_REV = "FUNDS_TRANSFER_REVERSAL";
    @ConfigProperty(name = "app.admin.initial-password", defaultValue = "changeit")
    String initialAdminPassword;
    @ConfigProperty(name = "app.admin.bcrypt-rounds", defaultValue = "12")
    int bcryptRounds;

    void onStart(@Observes StartupEvent event) {
        LOG.info("========================================");
        LOG.info("🚀 Démarrage de l'initialisation...");
        LOG.info("========================================");

        initializeCountry();
        initializeDepartment();
        initializeAdminUser();
        initializeFeatures();
        initializeApplications(); // <--- NOUVELLE MÉTHODE AJOUTÉE

        LOG.info("========================================");
        LOG.info("✅ Initialisation terminée avec succès");
        LOG.info("========================================");
    }

    // -------------------------------------------------------------------------
    // INITIALISATION DES APPLICATIONS (SCHÉMAS)
    // -------------------------------------------------------------------------

    void initializeApplications() {
        initFundsTransferApp();
        initFundsTransferReversalApp();
    }

    private void initFundsTransferApp() {
        try {
            if (Application.findByName(FEAT_FT) != null) {
                LOG.debugf("L'application '%s' existe déjà.", FEAT_FT);
                return;
            }

            Application app = new Application();
            app.name = FEAT_FT;
            app.description = "Module de transfert de fonds";

            List<SchemaField> fields = new ArrayList<>();

            // Charges & Commissions
            fields.add(new SchemaField("CHARGE.AMT", "Charge Amount", "DECIMAL", false, "CHARGE.AMT"));
            fields.add(new SchemaField("@ID", "Transaction Id", "STRING", false, "@ID"));
            fields.add(new SchemaField("CHARGE.CODE", "Charge Code", "STRING", false, "CHARGE.CODE"));
            fields.add(new SchemaField("CHARGE.TYPE", "Charge Type", "STRING", false, "CHARGE.TYPE"));
            fields.add(new SchemaField("COMMISSION.AMT", "Commission Amount", "DECIMAL", false, "COMMISSION.AMT"));
            fields.add(new SchemaField("COMMISSION.CODE", "Commission Code", "STRING", false, "COMMISSION.CODE"));
            fields.add(new SchemaField("COMMISSION.TYPE", "Commission Type", "STRING", false, "COMMISSION.TYPE"));

            // Crédit
            fields.add(new SchemaField("CREDIT.ACCT.NO", "Credit Account Number", "STRING", true, "CREDIT.ACCT.NO"));
            fields.add(new SchemaField("CREDIT.AMOUNT", "Credit Amount", "DECIMAL", false, "CREDIT.AMOUNT"));
            fields.add(new SchemaField("CREDIT.CURRENCY", "Credit Currency", "STRING", false, "CREDIT.CURRENCY"));
            fields.add(new SchemaField("CREDIT.THEIR.REF", "Credit Their Reference", "STRING", false, "CREDIT.THEIR.REF"));
            fields.add(new SchemaField("CREDIT.VALUE.DATE", "Credit Value Date", "DATE", false, "CREDIT.VALUE.DATE"));

            // Débit
            fields.add(new SchemaField("DEBIT.ACCT.NO", "Debit Account Number", "STRING", true, "DEBIT.ACCT.NO"));
            fields.add(new SchemaField("DEBIT.AMOUNT", "Debit Amount", "DECIMAL", false, "DEBIT.AMOUNT"));
            fields.add(new SchemaField("DEBIT.CURRENCY", "Debit Currency", "STRING", false, "DEBIT.CURRENCY"));
            fields.add(new SchemaField("DEBIT.THEIR.REF", "Debit Their Reference", "STRING", false, "DEBIT.THEIR.REF"));
            fields.add(new SchemaField("DEBIT.VALUE.DATE", "Debit Value Date", "DATE", false, "DEBIT.VALUE.DATE"));

            // Autres
            fields.add(new SchemaField("EXPOSURE.DATE", "Exposure Date", "DATE", false, "EXPOSURE.DATE"));
            fields.add(new SchemaField("ORDERING.BANK", "Ordering Bank", "STRING", false, "ORDERING.BANK"));
            fields.add(new SchemaField("ORDERING.CUST", "Ordering Customer", "STRING", false, "ORDERING.CUST"));
            fields.add(new SchemaField("PAYMENT.DETAILS", "Payment Details", "STRING", false, "PAYMENT.DETAILS"));
            fields.add(new SchemaField("PROCESSING.DATE", "Processing Date", "DATE", false, "PROCESSING.DATE"));
            fields.add(new SchemaField("PROFIT.CENTRE.CUST", "Profit Centre Customer", "STRING", false, "PROFIT.CENTRE.CUST"));
            fields.add(new SchemaField("PROFIT.CENTRE.DEPT", "Profit Centre Department", "STRING", false, "PROFIT.CENTRE.DEPT"));
            fields.add(new SchemaField("TRANSACTION.TYPE", "Transaction Type", "STRING", true, "TRANSACTION.TYPE"));

            app.setSchema(fields);
            app.persist();

            LOG.infof("✅ Application créée : %s (%d champs)", FEAT_FT, fields.size());

        } catch (Exception e) {
            LOG.errorf(e, "Échec init application %s", FEAT_FT);
        }
    }

    private void initFundsTransferReversalApp() {
        try {
            if (Application.findByName(FEAT_FT_REV) != null) {
                LOG.debugf("L'application '%s' existe déjà.", FEAT_FT_REV);
                return;
            }

            Application app = new Application();
            app.name = FEAT_FT_REV;
            app.description = "Extourne de transaction FT par la référence";

            List<SchemaField> fields = new ArrayList<>();
            fields.add(new SchemaField("TRANSACTION.ID", "Identifiant de la transaction a extourner", "STRING", true, "TRANSACTION.ID"));

            app.setSchema(fields);
            app.persist();

            LOG.infof("✅ Application créée : %s (%d champs)", FEAT_FT_REV, fields.size());

        } catch (Exception e) {
            LOG.errorf(e, "Échec init application %s", FEAT_FT_REV);
        }
    }

    // -------------------------------------------------------------------------
    // AUTRES INITIALISATIONS (Admin, Dept, Pays, Features)
    // -------------------------------------------------------------------------

    void initializeFeatures() {
        // Feature: FUNDS_TRANSFER
        try {
            if (AppFeatureConfig.findByName(FEAT_FT).isEmpty()) {
                AppFeatureConfig conf = new AppFeatureConfig();
                conf.configKey = FEAT_FT;
                conf.description = "Service de traitement";
                conf.isEnabled = false;
                conf.persist();
                LOG.infof("✅ Feature créée : %s", FEAT_FT);
            }
        } catch (Exception e) {
            LOG.errorf("Erreur feature %s: %s", FEAT_FT, e.getMessage());
        }

        // Feature: FUNDS_TRANSFER_REVERSAL
        try {
            if (AppFeatureConfig.findByName(FEAT_FT_REV).isEmpty()) {
                AppFeatureConfig conf = new AppFeatureConfig();
                conf.configKey = FEAT_FT_REV;
                conf.description = "Processeur d'annulation de virements";
                conf.isEnabled = false;
                conf.persist();
                LOG.infof("✅ Feature créée : %s", FEAT_FT_REV);
            }
        } catch (Exception e) {
            LOG.errorf("Erreur feature %s: %s", FEAT_FT_REV, e.getMessage());
        }
    }

    void initializeDepartment() {
        try {
            if (Departments.find("code", DEFAULT_DEPARTMENT_ID).count() == 0) {
                Departments department = new Departments();
                department.code = DEFAULT_DEPARTMENT_ID;
                department.description = DEFAULT_DEPARTMENT_DESC;
                department.persist();
                LOG.infof("✅ Département créé : %d", DEFAULT_DEPARTMENT_ID);
            }
        } catch (Exception e) {
            LOG.errorf("Erreur département: %s", e.getMessage());
        }
    }

    void initializeCountry() {
        try {
            if (Country.find("code", DEFAULT_COUNTRY_CODE).count() == 0) {
                Country country = new Country();
                country.code = DEFAULT_COUNTRY_CODE;
                country.companyId = DEFAULT_COMPANY_ID;
                country.persist();
                LOG.infof("✅ Pays créé : %s", DEFAULT_COUNTRY_CODE);
            }
        } catch (Exception e) {
            LOG.errorf("Erreur pays: %s", e.getMessage());
        }
    }

    void initializeAdminUser() {
        try {
            if (AppUser.findByUsername(ADMIN_USERNAME).isPresent()) return;

            AppUser admin = new AppUser();
            admin.username = ADMIN_USERNAME;
            String salt = BCrypt.gensalt(bcryptRounds);
            admin.setPasswordHash(BCrypt.hashpw(initialAdminPassword, salt));
            admin.setRole(AppUser.UserRole.ADMIN);
            admin.countryCode = DEFAULT_COUNTRY_CODE;
            admin.department = DEFAULT_DEPARTMENT_ID;
            admin.persist();

            LOG.infof("✅ Admin créé : %s", ADMIN_USERNAME);
            LOG.warn("⚠️  CHANGEZ LE MOT DE PASSE ADMIN RAPIDEMENT !");
        } catch (Exception e) {
            LOG.errorf("Erreur user admin: %s", e.getMessage());
        }
    }
}