package com.transact.processor.model;

import com.mongodb.client.model.IndexOptions;
import com.mongodb.client.model.Indexes;
import io.quarkus.mongodb.panache.PanacheMongoEntity;
import io.quarkus.mongodb.panache.common.MongoEntity;
import io.quarkus.runtime.StartupEvent;
import jakarta.enterprise.event.Observes;
import org.bson.types.ObjectId;

import java.time.Instant;

@MongoEntity(collection = "batch_statistics")
public class BatchStatistics extends PanacheMongoEntity {

    /**
     * Same ID as FileBatch
     */
    public ObjectId id;

    public ObjectId applicationId;
    public String batchStatus;

    public long totalRecords;
    public long successCount;
    public long failureCount;

    public Instant lastUpdatedAt;

    public BatchStatistics() {
    }

    /**
     * Computes batch statistics by counting BatchData row statuses directly.
     * This is the authoritative source — RowResult may be sparse (only written
     * on first completion/failure) but BatchData always reflects current state.
     */
    public static BatchStatistics calculate(ObjectId batchId) {
        long total = BatchData.count("batchId", batchId);
        long success = BatchData.count("batchId = ?1 and processingStatus = ?2",
                batchId, "COMPLETED");
        long failure = BatchData.count("batchId = ?1 and processingStatus in ?2",
                batchId, java.util.List.of("FAILED", "FAILED_PERMANENT", "NO_RESPONSE"));

        if (total == 0) return null;

        BatchStatistics stats = new BatchStatistics();
        stats.id = batchId;
        stats.totalRecords = total;
        stats.successCount = success;
        stats.failureCount = failure;
        stats.lastUpdatedAt = Instant.now();

        return stats;
    }

    void onStart(@Observes StartupEvent ev) {
        mongoCollection().createIndex(
                Indexes.ascending("applicationId"),
                new IndexOptions().background(true)
        );
    }
}
