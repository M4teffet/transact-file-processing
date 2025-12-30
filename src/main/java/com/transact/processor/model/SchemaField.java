package com.transact.processor.model;

import org.bson.codecs.pojo.annotations.BsonCreator;
import org.bson.codecs.pojo.annotations.BsonProperty;

public class SchemaField {

    private final String fieldName;
    private final String description;
    private final String dataType;
    private final Boolean isRequired;
    private final String ofsMapping;

    @BsonCreator
    public SchemaField(
            @BsonProperty("fieldName") String fieldName,
            @BsonProperty("description") String description,
            @BsonProperty("dataType") String dataType,
            @BsonProperty("isRequired") Boolean isRequired,
            @BsonProperty("ofsMapping") String ofsMapping
    ) {
        this.fieldName = fieldName;
        this.description = description;
        this.dataType = dataType;
        this.isRequired = isRequired;
        this.ofsMapping = ofsMapping;
    }

    public String getFieldName() {
        return fieldName;
    }

    public String getDescription() {
        return description;
    }

    public String getDataType() {
        return dataType;
    }

    public boolean isRequired() {
        return Boolean.TRUE.equals(isRequired);
    }

    public String getOfsMapping() {
        return ofsMapping;
    }
}
