package com.transact.service;

import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoDatabase;
import com.mongodb.client.gridfs.GridFSBucket;
import com.mongodb.client.gridfs.GridFSBuckets;
import com.mongodb.client.gridfs.model.GridFSUploadOptions;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.bson.Document;
import org.bson.types.ObjectId;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.io.InputStream;

/**
 * Thin wrapper around MongoDB GridFS.
 * Stores raw uploaded files before any parsing or validation so the
 * original bytes are always available for download, audit, or re-processing.
 *
 * Each file is stored in the "uploads" bucket (collections: uploads.files +
 * uploads.chunks) to keep it separate from other GridFS usage.
 */
@ApplicationScoped
public class GridFsService {

    @Inject
    MongoClient mongoClient;

    @ConfigProperty(name = "quarkus.mongodb.database", defaultValue = "transactdb")
    String databaseName;

    private GridFSBucket bucket() {
        MongoDatabase db = mongoClient.getDatabase(databaseName);
        return GridFSBuckets.create(db, "uploads");
    }

    /**
     * Store a raw file and return its GridFS ObjectId.
     *
     * @param filename    original filename (stored as GridFS filename metadata)
     * @param inputStream content to store — caller is responsible for closing
     * @param uploadedBy  username of the uploader, stored in file metadata
     * @return the ObjectId of the stored GridFS file (stored in FileBatch.gridFsFileId)
     */
    public ObjectId store(String filename, InputStream inputStream, String uploadedBy) {
        GridFSUploadOptions opts = new GridFSUploadOptions()
                .chunkSizeBytes(255 * 1024) // 255 KB chunks (GridFS default)
                .metadata(new Document("uploadedBy", uploadedBy));
        return bucket().uploadFromStream(filename, inputStream, opts);
    }

    /**
     * Open a download stream for a previously stored file.
     *
     * @param fileId GridFS ObjectId returned from {@link #store}
     * @return InputStream of the raw file bytes
     * @throws com.mongodb.MongoGridFSException if the file does not exist
     */
    public InputStream open(ObjectId fileId) {
        return bucket().openDownloadStream(fileId);
    }

    /**
     * Delete a stored file. Safe to call even if the file was never stored
     * (fileId is null) — returns silently in that case.
     */
    public void delete(ObjectId fileId) {
        if (fileId == null) return;
        bucket().delete(fileId);
    }
}
