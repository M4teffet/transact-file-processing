# ---- Build stage ----
FROM maven:3.9-eclipse-temurin-17-alpine AS build
WORKDIR /build

# Copy only pom.xml and download dependencies first (for cache efficiency)
COPY pom.xml .
RUN --mount=type=cache,target=/root/.m2 \
    mvn dependency:resolve dependency:resolve-plugins -DskipTests

# Copy source code
COPY src ./src

# Build the application
RUN --mount=type=cache,target=/root/.m2 \
    mvn clean package -DskipTests -q

# ---- Runtime stage ----
FROM eclipse-temurin:17-jre-alpine
WORKDIR /deployments

# Copy only the built Quarkus app from build stage
COPY --from=build /build/target/quarkus-app/ .

EXPOSE 8080

# Use exec form for proper signal handling
CMD ["java", "-jar", "quarkus-run.jar"]
