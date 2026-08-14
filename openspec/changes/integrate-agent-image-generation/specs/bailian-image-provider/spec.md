## ADDED Requirements

### Requirement: A versioned image catalog controls provider routing
The API SHALL maintain a repository-owned image-model catalog that separates public model IDs from provider and upstream model IDs. The initial catalog SHALL contain `qwen-image`, `wan-image`, `kling-image` and `vidu-image`, with Qwen Image as default, and SHALL declare each model's image-input, aspect-ratio, quality and watermark capabilities.

#### Scenario: Catalog resolves an enabled model
- **GIVEN** a Tool call selects an enabled platform image model
- **WHEN** the server resolves the call
- **THEN** it obtains the reviewed provider, upstream model ID and legal parameter mapping without trusting client or model-supplied provider metadata

#### Scenario: Selected model is disabled
- **GIVEN** a historical or newly requested platform image model is disabled
- **WHEN** the Tool attempts submission
- **THEN** the server blocks the paid call and returns enabled alternatives without silently changing models

### Requirement: Bailian models use one normalized task transport
The Bailian Adapter SHALL call the configured Beijing Base URL with the server-held API Key; these SHALL be the only image-specific environment settings and SHALL be configured together. It SHALL use the official synchronous multimodal endpoint for Qwen Image 2.0 Pro and `X-DashScope-Async: enable` plus task lookup for Wan, Kling and Vidu. The four mappers SHALL translate only their model-specific request and response fields while the shared Transport owns authentication, code-defined timeout, abort, submission, status lookup and normalized errors.

#### Scenario: Text-to-image task is submitted
- **GIVEN** the pending database transaction succeeded and the model is enabled
- **WHEN** the Tool submits through the Bailian Adapter
- **THEN** the Transport sends the reviewed upstream model and mapped defaults and persists the returned provider task ID

#### Scenario: Reference image is submitted
- **GIVEN** a valid same-Thread Sandbox image is selected
- **WHEN** the target model supports Base64 input
- **THEN** the API reads and validates the bytes and submits the supported encoded form
- **AND** it never sends the local path

#### Scenario: Reference transport is code-defined
- **GIVEN** any built-in image model is selected for a reference edit
- **WHEN** the Tool prepares that input
- **THEN** it submits the validated Sandbox bytes as the model's code-defined inline Base64/data URL form
- **AND** it does not require another public URL environment setting

### Requirement: Paid submission is durable and non-duplicating
Before any paid image call, the server SHALL atomically persist RequestLog, ImageGenerationTask and Agent Tool-call linkage. The provider/task pair SHALL be unique. A submission that may have been accepted but whose provider task ID cannot be reliably persisted SHALL become `SUBMISSION_UNKNOWN` and MUST NOT be automatically resubmitted.

#### Scenario: Pending transaction fails
- **GIVEN** PostgreSQL cannot create the pending records
- **WHEN** image generation is requested
- **THEN** the API fails closed and makes no Bailian request

#### Scenario: Provider explicitly rejects submission
- **GIVEN** pending records exist
- **WHEN** Bailian returns a definite request failure
- **THEN** the task, Tool result, RequestLog and BillingRecord terminate as failed without retrying another image model

#### Scenario: Submission outcome is unknown
- **GIVEN** the connection fails after Bailian may have accepted the request and no reliable task ID is stored
- **WHEN** the submission handler classifies the outcome
- **THEN** it stores `SUBMISSION_UNKNOWN`, exposes an operator-diagnosable state and does not create another paid request

### Requirement: Reconciler advances image tasks with PostgreSQL leases
An API-process Image Reconciler SHALL atomically lease due non-terminal tasks from PostgreSQL, query Bailian with bounded backoff and advance only legal state transitions. Temporary query errors SHALL retain the last known state; terminal writes and BillingRecord upsert SHALL be idempotent.

#### Scenario: API restarts during generation
- **GIVEN** a task has a persisted provider task ID and its lease is absent or expired
- **WHEN** the API starts and the task becomes due
- **THEN** the Reconciler resumes polling without submitting a replacement task

#### Scenario: Bailian is temporarily unavailable
- **GIVEN** a provider task is pending or running
- **WHEN** status lookup times out, is rate limited or returns a retryable server error
- **THEN** the platform retains the task state, records the bounded error and schedules a later lookup

#### Scenario: Two execution paths observe the same terminal result
- **GIVEN** online waiting and the Reconciler race to finish one task
- **WHEN** both attempt the terminal transition
- **THEN** conditional writes allow one terminal commit and one BillingRecord while the other observes the committed result

### Requirement: Successful provider output must enter the live Thread Sandbox
A provider success SHALL transition through `PERSISTING`. Before platform success, the API SHALL fetch only the recorded provider result using host, redirect, timeout, MIME, magic-byte and size controls and SHALL write one image to the owning live Thread Sandbox. It SHALL NOT use API container disk or implicit permanent OSS as fallback.

#### Scenario: Provider image passes validation
- **GIVEN** Bailian reports success and the Thread Sandbox is live
- **WHEN** the Reconciler validates and writes the image under the controlled output directory
- **THEN** the task becomes succeeded and the Tool result references a platform image identifier and controlled routes

#### Scenario: Provider result is unsafe
- **GIVEN** the result URL redirects to a disallowed host or returns an invalid, unsupported or oversized body
- **WHEN** the API validates the result
- **THEN** it rejects the asset without proxying or storing it and records a normalized provider-result error

#### Scenario: Sandbox expired before persistence
- **GIVEN** Bailian succeeded but the owning Sandbox has expired
- **WHEN** the Reconciler attempts persistence
- **THEN** the task becomes expired, the result is discarded and no replacement Sandbox or automatic Creation is created

### Requirement: Completed Tool calls resume their enclosing Agent Run
The platform SHALL persist enough Tool-call and Run state to resume an image-generation Agent Run after Tool completion or API restart. A leased Run-resume service SHALL reconstruct the tool-call/result history and perform the final text-model turn exactly once without regenerating the image.

#### Scenario: Tool completes while original request is connected
- **GIVEN** the image Tool result is committed
- **WHEN** the original Run executor still owns the Run
- **THEN** it continues the Agent loop and emits the final assistant summary once

#### Scenario: API restarted while Tool was running
- **GIVEN** the image Tool result later completes for a waiting persisted Run
- **WHEN** the Run-resume lease is acquired
- **THEN** the service reconstructs the history, generates the final summary and completes the existing Run

#### Scenario: Final summary fails
- **GIVEN** the image Tool result succeeded but the final text-model call fails
- **WHEN** the Run terminates or becomes retryable
- **THEN** the successful image remains available and no new provider image task is submitted

### Requirement: Provider validation is offline in CI and explicit in production enablement
Production and development registries SHALL expose no Mock image model. Automated CI SHALL use sanitized injected HTTP fixtures and MUST NOT require a provider Key, balance or external network. The repository SHALL NOT add a real-provider smoke CI script; each real model SHALL remain disabled until an operator records one lowest-cost manual validation.

#### Scenario: CI runs image contracts
- **GIVEN** no Bailian credentials or network are available
- **WHEN** unit, contract, integration and E2E suites run
- **THEN** all protocol, state, recovery and UI assertions use fixtures and make no paid request

#### Scenario: Operator enables a real model
- **GIVEN** a model mapper and catalog entry are ready for release
- **WHEN** the operator performs manual validation
- **THEN** the recorded evidence includes platform/upstream model, Beijing region, parameters, result, observed cost and disable procedure before enabling the model
