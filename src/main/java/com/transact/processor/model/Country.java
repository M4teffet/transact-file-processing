package com.transact.processor.model;

import io.quarkus.mongodb.panache.PanacheMongoEntity;
import io.quarkus.mongodb.panache.common.MongoEntity;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.Locale;
import java.util.Set;

@MongoEntity(collection = "country")
public class Country extends PanacheMongoEntity {

    private static final Set<String> VALID_ISO_ALPHA2_CODES = Locale.getISOCountries(Locale.IsoCountryCode.PART1_ALPHA2);

    @NotBlank(message = "Country code is required")
    @Size(min = 2, max = 2, message = "Country code must be exactly 2 characters")
    @Pattern(regexp = "[A-Z]{2}", message = "Country code must be two uppercase letters")
    public String code;

    @NotBlank(message = "Company ID is required")
    public String companyId;

    public Instant createdAt = Instant.now();

    public static String findByCode(String code) {
        if (code == null || !code.matches("[A-Z]{2}")) {
            return null;
        }

        Country country = find("code", code).firstResult();
        return country != null ? country.companyId : null;
    }

    private void normalize() {
        if (code != null) {
            code = code.toUpperCase(Locale.ROOT);
        }
    }

    private void validateDomain() {
        normalize();
        if (!VALID_ISO_ALPHA2_CODES.contains(code)) {
            throw new IllegalArgumentException("Invalid ISO 3166-1 alpha-2 country code: '" + code + "'");
        }
    }

    @Override
    public void persist() {
        validateDomain();
        super.persist();
    }

    @Override
    public void persistOrUpdate() {
        validateDomain();
        super.persistOrUpdate();
    }
}
