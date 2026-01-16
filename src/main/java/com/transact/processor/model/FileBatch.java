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
    public String originalFilename;
    public ValidationReport validationReport;
    public Instant validationTimestamp;

    public static FileBatch findActiveDuplicate(ObjectId appId, String filename) {
        // We only want to find records that are NOT in a failed state.
        // These are the statuses that should "Block" a new upload.
        List<String> blockingStatuses = List.of(
                STATUS_UPLOADED,
                STATUS_VALIDATED,
                STATUS_PROCESSING,
                STATUS_PROCESSED,
                STATUS_PROCESSED_PARTIAL
        );

        // If the existing file is in any of these, 'exists' will be true.
        // If it is in 'VALIDATED_FAILED', this query will return NULL, and 'exists' will be false.
        return find("applicationId = ?1 and originalFilename = ?2 and status in ?3",
                appId, filename, blockingStatuses).firstResult();
    }

    public static void ensureIndexes(@Observes StartupEvent ev) {
        // General index for dashboard/filtering
        mongoCollection().createIndex(
                Indexes.compoundIndex(Indexes.ascending("applicationId"), Indexes.ascending("status")),
                new IndexOptions().background(true)
        );

        // List of statuses that MUST be unique per filename
        List<String> blockingStatuses = List.of(
                STATUS_UPLOADED,
                STATUS_VALIDATED,
                STATUS_PROCESSING,
                STATUS_PROCESSED,
                STATUS_PROCESSED_PARTIAL
        );

        // The FIXED Partial Unique Index (uses $in to avoid the $not limitation)
        mongoCollection().createIndex(
                Indexes.compoundIndex(
                        Indexes.ascending("applicationId"),
                        Indexes.ascending("originalFilename")
                ),
                new IndexOptions()
                        .unique(true)
                        .background(true)
                        .partialFilterExpression(new org.bson.Document("status",
                                new org.bson.Document("$in", blockingStatuses)
                        ))
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