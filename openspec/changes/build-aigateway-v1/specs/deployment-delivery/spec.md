## ADDED Requirements

### Requirement: All V1 services run on one ECS host
The delivery SHALL provide a production Docker Compose definition for Nginx, Web, API, PostgreSQL, and Redis on one Ubuntu ECS host, with persistent PostgreSQL storage, explicit health checks, bounded container resources, restart policies, and internal-only data-service ports.

#### Scenario: Fresh host is provisioned
- **GIVEN** an Ubuntu host with Docker, Compose, repository checkout, and configured environment file
- **WHEN** the documented startup command is run
- **THEN** all services become healthy in dependency order
- **AND** PostgreSQL and Redis are not exposed directly to the public network

### Requirement: Nginx serves domain and public IP from one application entry
Nginx SHALL route `/` and `/admin` to Web, `/api/v1/*`, `/api-docs`, and health endpoints to API, and accept both the configured domain and direct public IP during deployment debugging. API calls SHALL use same-origin `/api` paths.

#### Scenario: Domain and IP are both configured
- **GIVEN** the domain A record points to the ECS public IP
- **WHEN** a visitor opens either supported host
- **THEN** the same Web application and API routes are reachable without client-side base URL changes

### Requirement: Nginx preserves Chat streaming semantics
For the Chat SSE route, Nginx SHALL disable proxy buffering and caching, use suitable read timeouts, preserve connection-close propagation, and avoid response transformations that batch chunks.

#### Scenario: Stream traverses production proxy
- **GIVEN** the SSE smoke harness emits delayed fixture chunks
- **WHEN** a browser calls Chat through Nginx
- **THEN** chunks arrive incrementally before the stream completes
- **AND** cancelling the browser request closes the upstream API request best effort

### Requirement: Web unavailability has a static deployment fallback
Nginx SHALL remain able to start independently of Web and API health. The deployment script SHALL enable a no-store static maintenance page before replacing existing application containers, and disable it only after readiness and smoke checks pass. When the Web upstream is unreachable and would produce `502`, `503`, or `504`, Nginx SHALL also return that page with a retry hint. API, health, and SSE endpoints MUST retain their protocol-native responses and MUST NOT be replaced by HTML.

#### Scenario: Web candidate fails to start during deployment
- **GIVEN** Nginx is running and the Web upstream cannot accept connections
- **WHEN** a visitor requests a document route such as `/` or `/admin`
- **THEN** the visitor receives HTTP `503` and the static maintenance page
- **AND** an API request remains an API error response rather than an HTML document

#### Scenario: Application startup fails after maintenance mode is enabled
- **GIVEN** a prior Nginx instance is serving the application
- **WHEN** the replacement API or Web container fails its Compose health gate
- **THEN** the deployment exits non-zero and the maintenance page remains enabled
- **AND** the script does not delete PostgreSQL data or attempt a database rollback

### Requirement: Private OTel services start with the production stack
Tempo and OpenTelemetry Collector SHALL be regular production Compose services, started by the deployment script before Nginx. They MUST NOT require an optional Compose profile because the same-origin `/otel` Nginx route depends on the Collector hostname.

#### Scenario: Production release starts the observability stack
- **WHEN** the production deployment script starts application services
- **THEN** Tempo becomes healthy before the Collector starts
- **AND** Nginx can resolve the Collector upstream and start successfully

### Requirement: Runtime configuration and secrets stay outside images
The deployment SHALL provide a documented `.env.example`, validate environment-specific variables, inject real API keys only at runtime, and keep production secrets out of source control, built images, browser bundles, API docs, and health responses.

#### Scenario: Image is built in CI
- **GIVEN** CI has no real provider key
- **WHEN** Web and API images are built and inspected
- **THEN** the images contain no production API credential

### Requirement: PostgreSQL data can be backed up and restored
The operational runbook SHALL include repeatable PostgreSQL backup, retention location, restore verification, and pre-deployment backup steps. Redis data SHALL not require backup.

#### Scenario: Deployment must be rolled back
- **GIVEN** a backup was taken before a database-affecting release
- **WHEN** the release fails its smoke checks
- **THEN** the operator can restore the prior application image and, when migration compatibility requires it, restore the documented PostgreSQL backup

### Requirement: CI and manual release have explicit gates
CI SHALL run formatting/lint checks, type checks, unit tests, Mock-based integration/E2E tests, builds, and Prisma migration validation. V1 production release SHALL remain a documented manual ECS procedure with health, Chat SSE, admin authentication, and persistence smoke checks.

#### Scenario: Change fails the streamed Chat smoke test
- **GIVEN** a candidate release is deployed on ECS
- **WHEN** the Nginx-routed Mock or configured provider Chat test does not stream or persist correctly
- **THEN** the release is not accepted and the operator follows the rollback procedure

### Requirement: Container logs are size bounded
Docker log rotation SHALL be configured for application and proxy containers so that full-Prompt structured logs cannot grow the system disk without bound.

#### Scenario: Log volume grows continuously
- **GIVEN** containers emit sustained logs
- **WHEN** a log file reaches its configured size and count limits
- **THEN** Docker rotates and removes the oldest segment according to policy while active services continue running

### Requirement: Database migration uses a dedicated runtime image
The production Migration image SHALL contain the Prisma CLI, Prisma configuration, and versioned migration files required by `prisma migrate deploy`, without inheriting the complete workspace build stage or including the pnpm content-addressable store.

#### Scenario: Migration image is exported on the ECS host
- **GIVEN** the API build stage and its dependency cache already exist
- **WHEN** Docker exports the production Migration target
- **THEN** the exported image contains no `/pnpm/store` or application build workspace
- **AND** the image can execute `prisma migrate deploy` against the configured PostgreSQL database
