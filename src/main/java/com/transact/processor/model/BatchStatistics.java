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
     * Computes batch statistics by counting rows in BatchData and RowResult.
     */
    public static BatchStatistics calculate(ObjectId batchId) {
        long total = BatchData.count("batchId", batchId);
        long success = RowResult.count("batchId = ?1 and status = ?2", batchId, "SUCCESS");
        long failure = RowResult.count("batchId = ?1 and status = ?2", batchId, "FAILED");

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
