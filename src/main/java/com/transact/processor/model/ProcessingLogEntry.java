package com.transact.processor.model;

import com.mongodb.client.model.IndexOptions;
import com.mongodb.client.model.Indexes;
import io.quarkus.mongodb.panache.PanacheMongoEntity;
import io.quarkus.mongodb.panache.common.MongoEntity;
import io.quarkus.runtime.StartupEvent;
import jakarta.enterprise.event.Observes;
import org.bson.types.ObjectId;

import java.time.Instant;
import java.util.concurrent.TimeUnit;

@MongoEntity(collection = "processing_logs")
public class ProcessingLogEntry extends PanacheMongoEntity {

    public ObjectId batchId;
    public String level;
    public String message;
    public Instant timestamp;

    public ProcessingLogEntry() {
        this.timestamp = Instant.now();
    }

    public ProcessingLogEntry(ObjectId batchId, String level, String message) {
        this.batchId = batchId;
        this.level = level != null ? level.toUpperCase() : "INFO";
        this.message = message;
        this.timestamp = Instant.now();
    }

    // ── Add TTL index creation at startup ───────────────────────────────
    public static void ensureIndexes(@Observes StartupEvent ev) {
        // TTL index: documents expire 72 hours (259200 seconds) after timestamp
        mongoCollection().createIndex(
                Indexes.ascending("timestamp"),
                new IndexOptions()
                        .background(true)
                        .expireAfter(24L * 60 * 60, TimeUnit.SECONDS) // 72 hours in seconds
        );
    }

    public static void log(ObjectId batchId, String level, String message) {
        new ProcessingLogEntry(batchId, level, message).persist();
    }

    public static void log(String level, String message) {
        log(null, level, message);
    }

    public void save() {
        this.persist();
    }
}