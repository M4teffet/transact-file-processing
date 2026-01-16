package com.transact;

import com.transact.processor.model.AppFeatureConfig;
import com.transact.processor.model.AppUser;
import com.transact.processor.model.Country;
import io.quarkus.runtime.StartupEvent;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import org.jboss.logging.Logger;
import org.mindrot.jbcrypt.BCrypt;

import java.util.Optional;

@ApplicationScoped
public class Initializer {

    private static final Logger LOG = Logger.getLogger(Initializer.class);

    private static final String DEFAULT_COUNTRY_CODE = "GB";
    private static final String DEFAULT_COMPANY_ID = "GB0010001";
    private static final String ADMIN_USERNAME = "admin";
    private static final String DEFAULT_FEATURE_configKey = "FUNDS_TRANSFER";
    private static final String DEFAULT_FEATURE_description = "Processing Service";
    private static final Boolean DEFAULT_FEATURE_isEnabled = false;

    private static final String INITIAL_ADMIN_PASSWORD =
            System.getenv().getOrDefault("INITIAL_ADMIN_PASSWORD", "changeit");

    void onStart(@Observes StartupEvent event) {
        initializeCountry();
        initializeAdminUser();
        initializeFeature();
    }

    void initializeCountry() {
        Optional<Country> existing =
                Country.find("code", DEFAULT_COUNTRY_CODE).firstResultOptional();

        if (existing.isPresent()) {
            Country country = existing.get();

            if (!DEFAULT_COMPANY_ID.equals(country.companyId)) {
                LOG.warnf(
                        "Country %s has unexpected companyId: expected=%s, found=%s",
                        DEFAULT_COUNTRY_CODE, DEFAULT_COMPANY_ID, country.companyId
                );
            }

            LOG.infof("Country already exists: %s", DEFAULT_COUNTRY_CODE);
            return;
        }

        Country country = new Country();
        country.code = DEFAULT_COUNTRY_CODE;
        country.companyId = DEFAULT_COMPANY_ID;
        country.persist();

        LOG.infof("✅ Created country: %s (companyId: %s)",
                DEFAULT_COUNTRY_CODE, DEFAULT_COMPANY_ID);
    }


    void initializeAdminUser() {
        if (AppUser.findByUsername(ADMIN_USERNAME).isPresent()) {
            LOG.info("Admin user already exists");
            return;
        }

        AppUser admin = new AppUser();
        admin.username = ADMIN_USERNAME;

        String salt = BCrypt.gensalt(12);           // increased to 12 rounds
        String hash = BCrypt.hashpw(INITIAL_ADMIN_PASSWORD, salt);

        admin.setPasswordHash(hash);
        admin.setRole(AppUser.UserRole.ADMIN);
        admin.countryCode = DEFAULT_COUNTRY_CODE;

        admin.persist();

        LOG.infof("✅ Created initial admin user '%s' (country: %s)", ADMIN_USERNAME, DEFAULT_COUNTRY_CODE);
        LOG.warn("Initial admin password was set from configuration / environment. Change it immediately after first login!");
    }

    void initializeFeature() {

        if (AppFeatureConfig.findByName(DEFAULT_FEATURE_configKey).isPresent()) {
            LOG.info("Default feature already exists");
            return;
        }

        AppFeatureConfig appFeatureConfig = new AppFeatureConfig();

        appFeatureConfig.configKey = DEFAULT_FEATURE_configKey;
        appFeatureConfig.description = DEFAULT_FEATURE_description;
        appFeatureConfig.isEnabled = DEFAULT_FEATURE_isEnabled;

        appFeatureConfig.persist();

        LOG.infof("✅ '%s' Feature Toggle added)", DEFAULT_FEATURE_configKey);
    }
}