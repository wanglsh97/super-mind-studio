## ADDED Requirements

### Requirement: Every accepted AI request has a persisted lifecycle
After validation and rate limiting, the API SHALL create a `RequestLog` with status `pending` before invoking a provider, then finalize it as `succeeded`, `failed`, or `cancelled` with timestamps, latency, provider selection, and normalized error information.

#### Scenario: Provider fails unexpectedly
- **GIVEN** a request log was created before provider invocation
- **WHEN** the provider call throws or its stream terminates with an error
- **THEN** the API finalizes the same request record as failed
- **AND** the failure remains queryable after the HTTP connection closes

### Requirement: Usage and estimated cost are recorded consistently
For completed calls the API SHALL normalize input, output, and total token usage where supplied, calculate estimated CNY cost from versioned configured pricing, and upsert one `BillingRecord` linked one-to-one with its `RequestLog`. Missing upstream usage SHALL be represented explicitly rather than guessed silently.

#### Scenario: Provider reports token usage
- **GIVEN** pricing exists for the resolved provider model
- **WHEN** a call completes with input and output token counts
- **THEN** the database and client usage extension contain consistent normalized usage and estimated CNY cost

### Requirement: V1 stores complete Prompt content with restricted presentation
V1 SHALL store complete Prompt/messages in PostgreSQL and Pino structured logs without automatic expiry. Public responses, log-list endpoints, and dashboard aggregate endpoints MUST NOT return complete Prompt content; only an authenticated request-detail endpoint may return it.

#### Scenario: Dashboard aggregates request records
- **GIVEN** RequestLog rows contain complete Prompts
- **WHEN** the dashboard query executes
- **THEN** its selected fields and serialized response exclude Prompt content

### Requirement: Structured logs correlate the request path
Pino logs SHALL include request ID, capability, model alias, provider, status, duration, usage, estimated cost, failover metadata, error code, and complete Prompt where applicable. API access logs and provider logs SHALL reuse the same request ID and SHALL never print API keys, session secrets, or authorization headers.

#### Scenario: One failed request is diagnosed
- **GIVEN** a failed request ID from the dashboard
- **WHEN** an operator searches container logs by that ID
- **THEN** validation, adapter selection, upstream failure, persistence finalization, and response events can be correlated

### Requirement: Redis limits and provider health are observable but disposable
Redis SHALL store per-IP rolling-window counters and short-lived provider health state with TTL. Redis persistence SHALL be disabled for V1; after restart the API SHALL rebuild health state from probes and subsequent calls without treating Redis as the source of billing or audit truth.

#### Scenario: Redis restarts
- **GIVEN** PostgreSQL contains historical request and billing records
- **WHEN** Redis restarts and loses counters and health keys
- **THEN** historical records remain intact
- **AND** new counters and health state are recreated through normal traffic and probes

### Requirement: Core gateway behavior is automatically verifiable
The project SHALL provide unit tests for protocol normalization, rate limiting, bounded failover, and cost calculation, plus at least one end-to-end Mock Agent test covering reasoning/text events, usage, terminal state, `[DONE]`, persistence, and cancellation.

#### Scenario: CI runs without paid provider access
- **GIVEN** PostgreSQL and Redis test services and Mock mode
- **WHEN** CI executes the test suite
- **THEN** the core tests pass without any real model API key or external provider call
