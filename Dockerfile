# ---- Runtime image ----
FROM eclipse-temurin:17-jre-alpine
WORKDIR /app

# Copy Quarkus app
COPY target/quarkus-app/ /app/

EXPOSE 8080

# Run the app
CMD ["java", "-jar", "quarkus-run.jar"]