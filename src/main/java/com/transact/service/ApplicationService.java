package com.transact.service;

import com.transact.processor.model.Application;
import com.transact.processor.model.SchemaField;
import io.quarkus.cache.CacheInvalidate;
import io.quarkus.cache.CacheResult;
import jakarta.enterprise.context.ApplicationScoped;
import org.eclipse.microprofile.openapi.annotations.media.Schema;

import java.util.ArrayList;
import java.util.List;

@ApplicationScoped
public class ApplicationService {

    @CacheResult(cacheName = "applications")
    public ApplicationFieldsResponse getApplicationFields(Application app) {
        List<FieldDTO> mandatory = new ArrayList<>();
        List<FieldDTO> optional = new ArrayList<>();

        for (SchemaField field : app.getSchema()) {
            FieldDTO dto = new FieldDTO(field.getFieldName(), field.getDataType());
            if (field.isRequired()) {
                mandatory.add(dto);
            } else {
                optional.add(dto);
            }
        }

        return new ApplicationFieldsResponse(app.name, mandatory, optional);
    }

    /**
     * Update or insert an application and invalidate the cache
     */
    @CacheInvalidate(cacheName = "applications")
    public void updateApplication(Application app) {
        app.persist(); // persists new or updates existing
    }

    /**
     * Optional: delete an application and invalidate cache
     */
    @CacheInvalidate(cacheName = "applications")
    public void deleteApplication(Application app) {
        app.delete();
    }

    @Schema(name = "FieldDTO")
    public record FieldDTO(
            @Schema(description = "Field name", example = "DEBIT.ACCT.NO") String fieldName,
            @Schema(description = "Data type", example = "STRING") String dataType
    ) {
    }

    @Schema(name = "ApplicationFieldsResponse")
    public record ApplicationFieldsResponse(
            @Schema(description = "Application name", example = "FUNDS_TRANSFER") String application,
            @Schema(description = "Mandatory fields") List<FieldDTO> mandatory,
            @Schema(description = "Optional fields") List<FieldDTO> optional
    ) {
    }
}