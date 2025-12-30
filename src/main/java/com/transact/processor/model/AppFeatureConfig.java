package com.transact.processor.model;

import io.quarkus.mongodb.panache.PanacheMongoEntity;
import io.quarkus.mongodb.panache.common.MongoEntity;

import java.time.Instant;

@MongoEntity(collection = "app_feature_configs")
public class AppFeatureConfig extends PanacheMongoEntity {

    public String configKey;
    public boolean isEnabled;
    public String description;
    public Instant lastUpdated;

    /**
     * Static helper to check the status of ANY feature by its key
     */
    public static boolean isFeatureEnabled(String key) {
        return find("configKey", key)
                .firstResultOptional()
                .map(config -> ((AppFeatureConfig) config).isEnabled)
                .orElse(true); // Default to true if not configured
    }
}