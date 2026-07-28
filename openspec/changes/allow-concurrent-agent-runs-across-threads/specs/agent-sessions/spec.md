## MODIFIED Requirements

### Requirement: Users can run Agents concurrently across different threads

The server SHALL allow one authenticated user to have active Agent runs in different threads up to a
configured per-user limit. The default limit SHALL be three and the accepted configuration range SHALL
be one through five. Each thread MUST still have at most one active run. Admission MUST be atomic
across concurrent requests, PostgreSQL active run state SHALL remain the source of truth, and Redis
failure MUST fail closed before provider, tool, or Sandbox work begins.

#### Scenario: Two different threads run concurrently

- **GIVEN** a user has an active run in thread A and remains below the configured user limit
- **WHEN** the same user starts a run in thread B
- **THEN** both runs execute independently
- **AND** their events, messages, cancellation, Sandbox state, usage and billing remain isolated

#### Scenario: Same thread rejects a second run

- **GIVEN** thread A already has an active run
- **WHEN** its owner submits another prompt to thread A
- **THEN** the server rejects the second run before invoking a provider, tool or Sandbox
- **AND** identifies the existing active run

#### Scenario: User concurrency limit is reached

- **GIVEN** a user has reached the configured active run limit across different threads
- **WHEN** that user starts another run
- **THEN** the server returns a concurrency-limit conflict without creating an AgentRun or user message

#### Scenario: Another user retains independent capacity

- **GIVEN** user A has reached their active run limit
- **WHEN** user B starts a valid run in their own thread
- **THEN** user B is evaluated against user B's limit and can run independently

### Requirement: Running messages cannot be queued or steered

While a thread has an active Agent run, the Web application SHALL disable submission for that thread
and the server SHALL reject additional prompts to that thread. A user MAY submit in another thread
when below the configured per-user concurrency limit. The Agent MUST NOT queue messages or inject
steering/follow-up messages into an active Pi loop.

#### Scenario: Submit to another thread while one run is active

- **GIVEN** the user's thread A has an active run and the user remains below their concurrency limit
- **WHEN** the user opens thread B
- **THEN** thread B's Composer remains enabled and can create an independent run

#### Scenario: Submit again to the running thread

- **GIVEN** thread A has an active run
- **WHEN** a modified client submits another prompt to thread A
- **THEN** the server rejects it and leaves the active run and transcript unchanged
