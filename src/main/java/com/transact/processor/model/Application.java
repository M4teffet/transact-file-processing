package com.transact.processor.model;

import io.quarkus.mongodb.panache.PanacheMongoEntity;
import io.quarkus.mongodb.panache.common.MongoEntity;
import org.bson.codecs.pojo.annotations.BsonProperty;

import java.util.List;

/**
 * Represents the "application" collection in MongoDB.
 * Matches the real FUNDS_TRANSFER schema with 100+ fields.
 */
@MongoEntity(collection = "application")
public class Application extends PanacheMongoEntity {

    public String name;
    public String description;

    @BsonProperty("schema")
    public List<SchemaField> schema;

    /**
     * Find application by code (case-sensitive)
     */
    public static Application findByName(String name) {
        return find("name", name).firstResult();
    }

    /**
     * Find all applications
     */
    public static List<Application> findAllApps() {
        return listAll();
    }

    /**
     * Getter
     */
    public List<SchemaField> getSchema() {
        return schema;
    }

    /**
     * Setter
     */
    public void setSchema(List<SchemaField> schema) {
        this.schema = schema;
    }
}


