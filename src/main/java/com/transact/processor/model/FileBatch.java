package com.transact.processor.model;

import com.mongodb.client.model.IndexOptions;
import com.mongodb.client.model.Indexes;
import com.transact.exception.ValidationError;
import io.quarkus.mongodb.panache.PanacheMongoEntity;
import io.quarkus.mongodb.panache.common.MongoEntity;
import io.quarkus.runtime.StartupEvent;
import jakarta.enterprise.event.Observes;
import org.bson.types.ObjectId;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

@MongoEntity(collection = "file_batch")
public class FileBatch extends PanacheMongoEntity {

    public static final String STATUS_UPLOADED = "UPLOADED";
    public static final String STATUS_UPLOADED_FAILED = "UPLOADED_FAILED";
    public static final String STATUS_VALIDATED = "VALIDATED";
    public static final String STATUS_VALIDATED_FAILED = "VALIDATED_FAILED";
    public static final String STATUS_PROCESSING = "PROCESSING";
    public static final String STATUS_PROCESSED = "PROCESSED";
    public static final String STATUS_PROCESSED_FAILED = "PROCESSED_FAILED";
    public static final String STATUS_PROCESSED_PARTIAL = "PROCESSED_WITH_ERROR";

    public ObjectId applicationId;
    public String status = STATUS_UPLOADED;

    public Instant uploadTimestamp = Instant.now();
    public Instant processingTimestamp;

    public String uploadedById;
    public String validatedById;
    public ValidationReport validationReport;
    public Instant validationTimestamp;

    public static void ensureIndexes(@Observes StartupEvent ev) {
        mongoCollection().createIndex(
                Indexes.compoundIndex(
                        Indexes.ascending("applicationId"),
                        Indexes.ascending("status")
                ),
                new IndexOptions().background(true)
        );
    }

    public static class ValidationReport {
        public int errors = 0;
        public int warnings = 0;
        public String summary;
        public List<ValidationError> details = new ArrayList<>();

        public ValidationReport() {
        }
    }
}
