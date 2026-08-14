## MODIFIED Requirements

### Requirement: Agent threads have mutable default models and Runs have immutable model snapshots

An authenticated owner SHALL be able to update an idle Agent Thread's default model to an enabled Agent-capable model without creating a new Thread. The server SHALL update the Thread `modelId` and `provider` together. Every Agent Run SHALL snapshot the Thread `modelId` and `provider` when admitted, and that snapshot MUST NOT change when the Thread default changes later. Model updates and Run creation for the same Thread SHALL be serialized by the same Thread-scoped lock.

#### Scenario: Owner switches an idle Thread model

- **GIVEN** an owned idle Thread is bound to Qwen and GLM is enabled for Agent use
- **WHEN** the owner updates that Thread model to GLM
- **THEN** the same Thread ID, transcript, title, Sandbox and summaries remain
- **AND** the Thread stores the GLM model ID and Provider together
- **AND** no conversation message is inserted by the switch

#### Scenario: Next Run snapshots the new model

- **GIVEN** a Thread was switched from Qwen to GLM
- **WHEN** its owner creates the next Run
- **THEN** the Run snapshots the GLM public model ID and Provider
- **AND** all model invocations in that Run begin from the Run snapshot
- **AND** earlier Qwen Run snapshots, usage and billing remain unchanged

#### Scenario: Active Thread rejects model switching

- **GIVEN** a Thread has a `RUNNING`, `CANCELLING` or `WAITING_FOR_USER` Run
- **WHEN** its owner attempts to update the Thread model
- **THEN** the server returns `409 AGENT_THREAD_ACTIVE_RUN`
- **AND** leaves the Thread model and active Run unchanged

#### Scenario: Another Thread does not block switching

- **GIVEN** Thread A has an active Run and owned Thread B is idle
- **WHEN** the user switches Thread B to another enabled Agent model
- **THEN** Thread B is updated successfully
- **AND** Thread A continues independently

#### Scenario: Disabled model is rejected

- **GIVEN** a model is absent from the enabled Agent model catalog
- **WHEN** a client submits it as a Thread model update
- **THEN** the server rejects the update without choosing a fallback
- **AND** the Thread retains its previous model

### Requirement: Users can run Agents concurrently across different threads

The server SHALL allow one authenticated user to have active Agent runs in different Threads up to a configured per-user limit. The default limit SHALL be five and the accepted configuration range SHALL be one through five. Each Thread MUST still have at most one active Run. Admission MUST be atomic across concurrent requests, PostgreSQL active Run state SHALL remain the source of truth, and Redis failure MUST fail closed before Provider, tool or Sandbox work begins.

#### Scenario: Five different Threads run concurrently

- **GIVEN** a user owns five different idle Threads and has no active Runs
- **WHEN** the user starts one Run in each Thread
- **THEN** all five Runs are admitted and execute independently
- **AND** their events, messages, cancellation, Sandbox state, usage and billing remain isolated

#### Scenario: Sixth concurrent Thread is rejected

- **GIVEN** a user already has five active Runs in five different Threads
- **WHEN** the user starts a Run in a sixth Thread
- **THEN** the server returns `AGENT_USER_CONCURRENCY_LIMIT` with limit five
- **AND** creates no user message, AgentRun or RequestLog
- **AND** invokes no Provider, tool or Sandbox

#### Scenario: Same Thread remains single-run

- **GIVEN** a Thread already has an active Run
- **WHEN** its owner submits another prompt to that Thread
- **THEN** the server rejects the second Run and identifies the existing active Run
- **AND** other owned Threads retain independent capacity
