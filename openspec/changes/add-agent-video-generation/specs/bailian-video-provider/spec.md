## ADDED Requirements

### Requirement: A versioned catalog aggregates four provider capability sets
The API SHALL maintain a repository-owned video-model catalog for Bailian Kling, HappyHorse, Vidu and PixVerse models. Each concrete version SHALL declare text-to-video, first-frame generation, audio, duration, resolution, aspect-ratio and supported mode capabilities. The default request SHALL be 5 seconds, 720P, audio enabled and 16:9 for text-to-video.

#### Scenario: Default text request is routed
- **GIVEN** a user provides no explicit video parameters
- **WHEN** the catalog resolves eligible candidates
- **THEN** it includes only concrete models that natively support text-to-video, 5 seconds, 720P, 16:9 and audio

#### Scenario: First-frame request is routed
- **GIVEN** a request includes one valid first-frame image
- **WHEN** candidates are resolved
- **THEN** the catalog requires first-frame and requested audio/duration/resolution capabilities
- **AND** does not require the text-to-video 16:9 default because the image controls aspect ratio

### Requirement: Routing uses an environment-configured default and Thread soft binding
For a Thread without a video binding, the router SHALL select an eligible model from the brand configured by `BAILIAN_VIDEO_DEFAULT_BRAND`, whose environment default is HappyHorse. If the configured brand cannot satisfy the executable request, it SHALL deterministically select another satisfying candidate. Later requests SHALL prefer the bound model. If that model lacks a newly required capability, the router SHALL select a satisfying model with the same rule and update the binding without user selection.

#### Scenario: First video is generated
- **GIVEN** multiple catalog models satisfy the request and the Thread has no binding
- **WHEN** routing occurs
- **THEN** an eligible model from the configured default brand is selected and persisted as the Thread binding

#### Scenario: Bound model remains compatible
- **GIVEN** the Thread has a bound model that satisfies the inherited and updated request
- **WHEN** the next video Run begins
- **THEN** the same model is reused without default selection

#### Scenario: Bound model becomes incompatible
- **GIVEN** the user requests a capability unsupported by the bound model but supported elsewhere in the catalog
- **WHEN** routing occurs
- **THEN** a compatible model is selected, the binding is replaced and the switch is audit logged

### Requirement: Unsupported modifications use best-effort generation
The outer Agent SHALL accept unrestricted natural-language modification requests. If no catalog model supports an explicitly requested generation parameter, the platform SHALL retain the prior executable parameter, preserve the unsupported intent in the effective Prompt and continue generation without an error or unsupported-parameter notice.

#### Scenario: No model supports a requested setting
- **GIVEN** the user requests a duration or resolution unsupported by every enabled model
- **WHEN** the Agent and router build the executable request
- **THEN** the prior legal duration or resolution is retained, the semantic request remains in the Prompt and generation proceeds normally

### Requirement: Bailian adapters normalize asynchronous tasks without automatic retry
Provider-specific request, authentication, response and error types SHALL remain inside Bailian video adapters. A shared transport SHALL submit asynchronous tasks with the reviewed Beijing endpoint and server-held credentials and query by the persisted provider task ID. Any definite submission or task failure SHALL fail the Run without retry, resubmission or provider failover.

#### Scenario: Provider rejects submission
- **GIVEN** durable pending records exist
- **WHEN** Bailian returns a definite submission failure
- **THEN** the task and Run fail and no other model is invoked

#### Scenario: Provider task fails asynchronously
- **GIVEN** a provider task ID is persisted
- **WHEN** Bailian reports the task failed
- **THEN** the platform records the normalized error and terminates the Run without automatic retry

### Requirement: Paid task submission and recovery are durable
Before calling Bailian, the service SHALL atomically persist the RequestLog, VideoGenerationTask and ToolCall linkage. The provider task ID and platform idempotency key SHALL be persisted immediately after submission. API restart recovery SHALL query the same task and MUST NOT create a replacement paid task.

#### Scenario: Pending persistence fails
- **GIVEN** PostgreSQL cannot create the pending lifecycle records
- **WHEN** generation is requested
- **THEN** the API fails closed and does not call Bailian

#### Scenario: API restarts during generation
- **GIVEN** a non-terminal task has a persisted provider task ID
- **WHEN** the API restarts and acquires its expired lease
- **THEN** it resumes querying that provider task without resubmission

### Requirement: A persistent reconciler drives task completion
An API-process Video Reconciler SHALL use PostgreSQL leases and due times to advance non-terminal tasks independently of browser polling. It SHALL hold a Thread Sandbox lease while a task is active and SHALL resume the enclosing Agent Tool loop after committing a terminal Tool result.

#### Scenario: User closes the page
- **GIVEN** a video task is running and the browser disconnects
- **WHEN** the provider later completes
- **THEN** the Reconciler persists the result and the Agent Run continuation completes without requiring client polling

#### Scenario: Competing executors observe completion
- **GIVEN** two execution paths attempt to finalize one task
- **WHEN** both perform conditional terminal updates
- **THEN** exactly one Tool result and one billing record are committed

### Requirement: Video tasks have a 15-minute platform timeout
A video task SHALL time out 15 minutes after provider submission. Platform timeout SHALL terminate the Run, release the Sandbox lease and prevent any late provider result from reaching the user or Sandbox. Timeout SHALL NOT trigger another video task.

#### Scenario: Provider remains non-terminal past the deadline
- **GIVEN** a task has not reached a provider terminal state within 15 minutes
- **WHEN** the Reconciler evaluates its deadline
- **THEN** the platform task becomes timed out, the Run terminates and no retry occurs

### Requirement: Cancellation is immediate and provider reconciliation is separate
Stopping a video Run SHALL immediately mark its platform task cancelled, end UI delivery and release the Thread foreground lock. The service SHALL attempt provider cancellation best-effort and MAY continue low-frequency provider reconciliation for final status and cost, but SHALL never download or display a late result.

#### Scenario: Provider cannot confirm cancellation
- **GIVEN** the user stopped a Run and Bailian still reports running
- **WHEN** a new Run begins in the same Thread
- **THEN** the new foreground Run is accepted
- **AND** the cancelled provider task remains background reconciliation only

### Requirement: Video usage uses a dedicated call-level ledger
Every video Tool call SHALL store actual provider/model, provider task ID, request and effective parameter snapshots, price version, billable seconds, resolution, audio, platform status, provider final status and RMB cost. Estimated prices SHALL be marked as estimates. Ordinary users SHALL NOT receive provider identity or cost; administrators SHALL be able to query them.

#### Scenario: A logically cancelled task later incurs cost
- **GIVEN** a platform task is cancelled but the provider later reports successful billable output
- **WHEN** reconciliation updates the provider final state
- **THEN** the platform state remains cancelled while the ledger records the provider outcome and estimated or exact cost

### Requirement: Automated provider validation is offline
Unit, contract, integration and E2E tests SHALL use deterministic sanitized HTTP fixtures and MUST NOT require real Bailian credentials, balance or external network. Real model enablement SHALL use bounded lowest-cost manual validation and record region, concrete model ID, parameters, audio result, observed cost and rollback procedure.

#### Scenario: CI validates all four brands
- **GIVEN** no provider credentials are present
- **WHEN** the provider contract suite runs
- **THEN** Kling, HappyHorse, Vidu and PixVerse mappings, failures, cancellation and recovery are verified entirely from fixtures
