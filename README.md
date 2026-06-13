# Transact File Processing

A **Quarkus 3.15 / Java 17** application for bulk CSV file processing into Temenos Transact (T24) core banking via REST
API.

It enforces a four-eyes workflow: an **Inputter** uploads and validates a file, a **Validator** reviews and approves it,
and a background scheduler sends each record to the T24 API automatically.

---

## Architecture

```
┌────────────┐
│ CSV Upload │
└─────┬──────┘
      │
      ▼
┌──────────────────────────────┐
│ Ingestion Layer              │
│ • FileParser                 │
│ • FileValidator              │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ Batch Management             │
│ Status = UPLOADED            │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ Human Approval Workflow      │
│ PUT /api/batches/{id}        │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ Status = VALIDATED           │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ Processing Engine            │
│ FundsTransferProcessor       │
│ (Scheduled Every 1 Minute)   │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ Integration Layer            │
│ T24 REST API                 │
│ Concurrent Transfer Calls    │
└──────────────┬───────────────┘
               │
               ▼
        ┌───────────────┐
        │ Final Status  │
        └───────┬───────┘
                │
     ┌──────────┼──────────┐
     ▼          ▼          ▼
 PROCESSED  PROCESSED_   PROCESSED_
            WITH_ERROR     FAILED
```

**Supported transaction types:** `FUNDS_TRANSFER`, `FUNDS_TRANSFER_REVERSAL`, `DATA_CAPTURE`

---

## Prerequisites

- Java 17+
- MongoDB 6+
- Maven 3.8+ (or use the included `./mvnw` wrapper)

---

## Configuration

Copy and populate the required environment variables before running:

```bash
# MongoDB
export MONGO_URL=mongodb://localhost:27017

# T24 API credentials — REQUIRED, no defaults
export FUNDS_TRANSFER_API_URL=https://your-t24-host/api/v1.0.0/order/payments
export FT_API_USER=your_api_user
export FT_API_PASS=your_api_password

# JWT keys (see Security section below)
export JWT_PUBLIC_KEY_PATH=file:/path/to/rsaPublicKey.pem
export JWT_PRIVATE_KEY_PATH=file:/path/to/pkcs8_privateKey.pem
```

### JWT Key Generation

JWT keys are **not included in the repository**. Generate your own key pair:

```bash
# Generate RSA private key
openssl genrsa -out privateKey.pem 2048

# Convert to PKCS8 format (required by SmallRye JWT)
openssl pkcs8 -topk8 -nocrypt -in privateKey.pem -out pkcs8_privateKey.pem

# Extract public key
openssl rsa -pubout -in privateKey.pem -out rsaPublicKey.pem
```

Store keys securely (e.g. Kubernetes Secrets, HashiCorp Vault) and provide paths via `JWT_PUBLIC_KEY_PATH` /
`JWT_PRIVATE_KEY_PATH`.

---

## Running

### Development mode (live reload)

```bash
./mvnw quarkus:dev
```

Dev UI available at: http://localhost:8080/q/dev/

### Packaging

```bash
./mvnw package
java -jar target/quarkus-app/quarkus-run.jar
```

### Über-jar

```bash
./mvnw package -Dquarkus.package.jar.type=uber-jar
java -jar target/*-runner.jar
```

### Native executable

```bash
# With GraalVM installed
./mvnw package -Dnative

# Without GraalVM (uses Docker)
./mvnw package -Dnative -Dquarkus.native.container-build=true

./target/transact-file-processor-1.0-SNAPSHOT-runner
```

### Docker

```bash
docker-compose up
```

---

## API Overview

| Method   | Path                           | Role     | Description                                |
|----------|--------------------------------|----------|--------------------------------------------|
| `POST`   | `/api/login`                   | Public   | Authenticate, receive JWT cookie           |
| `POST`   | `/api/inputter/upload`         | INPUTTER | Upload and validate a CSV file             |
| `GET`    | `/api/inputter/check-filename` | INPUTTER | Check if filename already exists           |
| `GET`    | `/api/batches`                 | Any      | List batches (filtered by country/dept)    |
| `GET`    | `/api/batches/{id}`            | Any      | Get batch details with row results         |
| `PUT`    | `/api/batches/{id}`            | Any      | Approve batch (moves to VALIDATED)         |
| `DELETE` | `/api/batches/{id}`            | Any      | Delete batch (only UPLOADED/FAILED states) |
| `GET`    | `/api/batches/stats`           | Any      | Aggregated dashboard statistics            |
| `GET`    | `/api/batches/processing-logs` | Any      | Processing logs                            |

OpenAPI UI (dev only): http://localhost:8080/q/swagger-ui/

---

## Batch Lifecycle

```
UPLOADED → VALIDATED → PROCESSING → PROCESSED
                ↘                 ↘ PROCESSED_WITH_ERROR
          VALIDATED_FAILED         PROCESSED_FAILED
UPLOADED_FAILED
```

---

## Security

- **JWT RS256** authentication via cookie (`AuthToken`)
- **Roles:** `INPUTTER` (upload), `VALIDATOR` (approve), `ADMIN` (full access)
- **Four-eyes:** inputter and validator must be different users
- **Geographic isolation:** users only see batches from their own country + department (ADMIN bypasses this)
- **Input sanitisation:** SQL injection pattern detection on all string fields

---

## Key Configuration Properties

| Property                            | Env Var            | Default                     | Description                                  |
|-------------------------------------|--------------------|-----------------------------|----------------------------------------------|
| `quarkus.http.port`                 | `PORT`             | `8080`                      | HTTP port                                    |
| `com.transact.upload.max-lines`     | `MAX_UPLOAD_LINES` | `1000`                      | Max CSV rows per upload                      |
| `ft.processor.max-threads`          | —                  | `2`                         | Concurrent T24 API calls per batch           |
| `ft.processor.max-retry`            | —                  | `3`                         | Max retries per row before permanent failure |
| `quarkus.mongodb.connection-string` | `MONGO_URL`        | `mongodb://localhost:27017` | MongoDB URI                                  |

---

## Related Guides

- [Quarkus REST](https://quarkus.io/guides/rest)
- [MongoDB with Panache](https://quarkus.io/guides/mongodb-panache)
- [SmallRye JWT](https://quarkus.io/guides/security-jwt)
- [Quarkus Scheduler](https://quarkus.io/guides/scheduler)
