package com.transact.processor.model;

import io.quarkus.mongodb.panache.PanacheMongoEntity;
import io.smallrye.common.constraint.NotNull;
import jakarta.validation.constraints.NotBlank;

import java.time.Instant;

public class Departments extends PanacheMongoEntity {

    @NotNull
    public Integer code;

    @NotBlank
    public String description;
    public Instant createdAt = Instant.now();

    public static String findByCode(Integer code) {

        Departments department = find("code", code).firstResult();

        return department != null ? department.description : null;
    }

    public Integer getCode() {
        return code;
    }
}
