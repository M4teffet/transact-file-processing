package com.transact.processor.model;

import io.quarkus.mongodb.panache.PanacheMongoEntity;
import io.quarkus.mongodb.panache.common.MongoEntity;
import org.bson.types.ObjectId;

import java.time.Instant;

@MongoEntity(collection = "processing_logs")
public class ProcessingLogEntry extends PanacheMongoEntity {

    public ObjectId batchId;           // ID du batch concerné (nullable si log global)
    public String level;           // "INFO", "WARN", "ERROR"
    public String message;         // Message détaillé
    public Instant timestamp;      // Date/heure du log

    // Constructeur par défaut requis par Panache
    public ProcessingLogEntry() {
        this.timestamp = Instant.now();
    }

    // Constructeur pratique
    public ProcessingLogEntry(ObjectId batchId, String level, String message) {
        this.batchId = batchId;
        this.level = level != null ? level.toUpperCase() : "INFO";
        this.message = message;
        this.timestamp = Instant.now();
    }


    // Méthode statique pour logger facilement
    public static void log(ObjectId batchId, String level, String message) {
        new ProcessingLogEntry(batchId, level, message).persist();
    }

    // Log global (sans batchId)
    public static void log(String level, String message) {
        log(null, level, message);
    }


    // Méthode d'instance pour persister (facultatif)
    public void save() {
        this.persist();
    }
}