package com.transact.processor.model;

import io.quarkus.mongodb.panache.PanacheMongoEntity;
import io.quarkus.mongodb.panache.common.MongoEntity;
import org.bson.types.ObjectId;

import java.time.Instant;
import java.util.List;
import java.util.Map;

@MongoEntity(collection = "batch_data")
public class BatchData extends PanacheMongoEntity {

    public ObjectId batchId;
    public int lineNumber;
    public Map<String, Object> data;

    public String processingStatus = "PENDING";
    public String workerId;
    public int retryCount = 0;
    public Instant createdAt = Instant.now();

    public static List<BatchData> findByBatchId(ObjectId batchId) {
        return list("batchId", batchId);
    }

    /**
     * Atomically claims a row only if it's still PENDING.
     */
    public static boolean claimRow(ObjectId rowId, String workerId) {
        // USE Parameters: This makes the code readable and ensures types are handled correctly
        long updated = update("processingStatus = 'CLAIMED', workerId = :workerId")
                .where("_id = :id and processingStatus = 'PENDING'",
                        io.quarkus.panache.common.Parameters.with("workerId", workerId)
                                .and("id", rowId));

        return updated > 0;
    }


}
