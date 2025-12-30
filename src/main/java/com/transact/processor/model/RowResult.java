package com.transact.processor.model;

import com.mongodb.client.model.IndexOptions;
import com.mongodb.client.model.Indexes;
import io.quarkus.mongodb.panache.PanacheMongoEntity;
import io.quarkus.mongodb.panache.common.MongoEntity;
import io.quarkus.runtime.StartupEvent;
import jakarta.enterprise.event.Observes;
import org.bson.types.ObjectId;

@MongoEntity(collection = "file_row_results")
public class RowResult extends PanacheMongoEntity {

    public ObjectId batchId;
    public int lineNumber;
    public String status; // SUCCESS | FAILED
    public String t24Reference;
    public String errorMessage;

    public RowResult() {
    }

    public RowResult(ObjectId batchId, int lineNumber, String status, String ref, String err) {
        this.batchId = batchId;
        this.lineNumber = lineNumber;
        this.status = status;
        this.t24Reference = ref;
        this.errorMessage = err;
    }

    public static void ensureIndexes(@Observes StartupEvent ev) {
        mongoCollection().createIndex(
                Indexes.compoundIndex(
                        Indexes.ascending("batchId"),
                        Indexes.ascending("lineNumber")
                ),
                new IndexOptions().unique(true).background(true)
        );

        mongoCollection().createIndex(
                Indexes.compoundIndex(
                        Indexes.ascending("batchId"),
                        Indexes.ascending("status")
                ),
                new IndexOptions().background(true)
        );
    }
}
