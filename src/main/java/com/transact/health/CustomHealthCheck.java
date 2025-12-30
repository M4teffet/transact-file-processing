package com.transact.health;

import com.transact.processor.model.Application;
import jakarta.enterprise.context.ApplicationScoped;
import org.eclipse.microprofile.health.HealthCheck;
import org.eclipse.microprofile.health.HealthCheckResponse;
import org.eclipse.microprofile.health.Readiness;

@Readiness
@ApplicationScoped
public class CustomHealthCheck implements HealthCheck {

    @Override
    public HealthCheckResponse call() {
        boolean mongoUp = isMongoConnected();

        return HealthCheckResponse.named("file-upload-service")
                .status(mongoUp)
                .withData("mongo", mongoUp ? "UP" : "DOWN")
                .withData("database", "file_processor_db")
                .build();
    }

    private boolean isMongoConnected() {
        try {
            Application.count(); // Lightweight query
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}