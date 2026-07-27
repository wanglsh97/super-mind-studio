## ADDED Requirements

### Requirement: Authenticated users can submit image generation jobs
The Image page SHALL require a valid GitHub UserSession, then allow the user to enter a Chinese or English Prompt, select an enabled image alias (`wanxiang` or `cogview`), configure only supported generation options, and submit a job through `@supermind/sdk`.

#### Scenario: Image job is accepted
- **GIVEN** a valid UserSession, a valid Prompt, an enabled image model, and an IP below its rate limit
- **WHEN** the visitor submits the form
- **THEN** `POST /api/v1/images/generations` returns a platform task ID and normalized initial status
- **AND** an `ImageGenerationTask` record exists before upstream status polling begins

### Requirement: Image job state is normalized and persisted
The API SHALL map provider-specific states to `pending`, `running`, `succeeded`, or `failed`, persist transitions and provider task identifiers, and expose current state through `GET /api/v1/images/generations/:taskId`.

Providers that only expose synchronous image generation MAY return a terminal submission. The API SHALL persist that terminal result and finish the related request lifecycle before responding; it SHALL NOT rely on process-local state or substitute a different provider model to simulate an asynchronous task.

#### Scenario: Synchronous provider completes during submission
- **GIVEN** the platform pending task exists before the paid provider call
- **WHEN** a synchronous provider returns image results
- **THEN** the API persists the provider correlation identifier, terminal task results, RequestLog outcome, and BillingRecord before responding
- **AND** a later GET after API restart reads the same terminal task from PostgreSQL without another provider call

#### Scenario: Provider task succeeds
- **GIVEN** a persisted task in pending or running state
- **WHEN** the provider reports successful output
- **THEN** the API stores normalized result metadata and marks the task succeeded
- **AND** subsequent status requests return the same terminal state without creating a duplicate upstream task

#### Scenario: API process restarts during a job
- **GIVEN** a submitted provider task is persisted
- **WHEN** the API restarts and the client polls with its task ID
- **THEN** the API resumes status lookup from PostgreSQL and the provider task ID

### Requirement: SDK encapsulates submit and poll behavior
`@supermind/sdk` SHALL provide low-level submit/status methods and a bounded polling helper that stops on success, failure, timeout, or caller cancellation.

#### Scenario: Polling times out
- **GIVEN** a task remains non-terminal beyond the configured SDK timeout
- **WHEN** the polling deadline is reached
- **THEN** the SDK stops polling and returns a typed timeout error without marking the server task failed

### Requirement: Generated images are downloaded through the gateway
The Web application SHALL use `GET /api/v1/images/generations/:taskId/images/:index/download` for downloads. The API SHALL verify task and image index, fetch the allowed upstream result, and proxy it with safe content headers instead of exposing a long-lived provider credential or trusting an arbitrary client URL.

#### Scenario: Visitor downloads a generated image
- **GIVEN** a succeeded task with an allowed image index
- **WHEN** the visitor downloads the image
- **THEN** the response streams through the API with an image content type and attachment filename

### Requirement: Image usage is IP limited
The gateway SHALL enforce a configurable default limit of 5 image submissions per source IP per 60 seconds before creating an upstream task.

#### Scenario: IP exceeds image limit
- **GIVEN** one source IP has consumed its image allowance
- **WHEN** it submits another generation request in the same window
- **THEN** the API returns 429 and creates neither an upstream task nor a database task

### Requirement: Recent image history is local to the visitor
The Image page SHALL keep at most the five most recent task summaries, thumbnails, and Prompts in localStorage and SHALL tolerate missing, expired, or invalid stored results.

#### Scenario: Visitor returns to the page
- **GIVEN** valid local history entries exist
- **WHEN** the Image page loads
- **THEN** up to five recent entries are displayed after Session restoration without creating server-side history records
