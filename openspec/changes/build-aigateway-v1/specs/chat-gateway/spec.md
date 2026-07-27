## ADDED Requirements

### Requirement: Anonymous users can run a single-model streamed chat
The public Chat page SHALL let an anonymous visitor select one enabled text-model alias, submit a conversation, render Markdown incrementally, stop generation, clear the conversation, and start another request without creating an account.

#### Scenario: Successful streamed conversation
- **GIVEN** an enabled model alias and a visitor below the rate limit
- **WHEN** the visitor submits a non-empty message
- **THEN** the Web application calls `@supermind/sdk`
- **AND** assistant content is rendered incrementally until the completion event
- **AND** the final usage and estimated CNY cost are available to the client

### Requirement: Chat uses one stable POST SSE contract
`POST /api/v1/chat/completions` SHALL require `stream: true` and return OpenAI-compatible `text/event-stream` chunks, a platform usage extension, and a final `data: [DONE]` frame. Every accepted request SHALL have a request ID that is available in the response and persisted record.

#### Scenario: Stream completes normally
- **GIVEN** an adapter yields content and usage
- **WHEN** the gateway forwards the result
- **THEN** every event is a valid SSE `data:` frame in the documented normalized schema
- **AND** exactly one usage result is emitted before exactly one `[DONE]` frame

#### Scenario: Invalid non-stream request
- **GIVEN** a chat payload sets `stream` to false or omits it
- **WHEN** the API validates the request
- **THEN** the API returns a normalized 400 JSON error before opening an SSE stream

### Requirement: Selectable model instances are resolved through a configurable catalog
The gateway SHALL accept stable public model instance IDs and resolve each instance through a version-controlled, repository-owned catalog to a community display name, one of the supported domestic provider adapters, and an actual upstream model ID. Multiple public model instances MAY resolve to the same provider adapter. Runtime environment variables MUST NOT replace or mutate the model catalog. A shared OpenAI-compatible transport MAY handle common HTTP/SSE behavior, while each adapter MUST own authentication, request mapping, chunk mapping, usage mapping, and error mapping.

#### Scenario: A second Kimi model is added
- **GIVEN** a Kimi provider Adapter is enabled and an existing Kimi model instance remains configured
- **WHEN** a developer appends a Kimi K3 entry to the repository model catalog and deploys the reviewed change
- **THEN** model discovery returns both Kimi instances with their configured community names
- **AND** clients can select either public model ID without adding a new provider Adapter or changing a frontend model union
- **AND** persisted records contain the selected public model ID, provider alias, and resolved upstream model ID

#### Scenario: Runtime attempts to override the catalog
- **GIVEN** a deployment environment contains an unreviewed `CHAT_MODELS` value
- **WHEN** the upgraded API starts
- **THEN** the runtime value does not alter the repository-owned model list
- **AND** only API credentials, provider endpoints, and provider enable flags remain deployment configuration

### Requirement: Single-model failover is bounded by the first delta
For single-model chat only, the gateway SHALL attempt a configured fallback when the primary returns a timeout or eligible 5xx error before any content delta is sent. The gateway MUST NOT switch providers after the first content delta, and MUST NOT apply failover in comparison mode.

#### Scenario: Primary fails before first delta
- **GIVEN** a single-model request with a healthy configured fallback
- **WHEN** the primary times out before yielding content
- **THEN** the fallback handles the request without mixing primary content
- **AND** the request log records the original model, fallback model, and failure reason

#### Scenario: Primary fails after content begins
- **GIVEN** the client has received at least one primary content delta
- **WHEN** the primary stream fails
- **THEN** the gateway emits a normalized stream error and terminates
- **AND** it does not append content from another model

### Requirement: Client cancellation propagates best effort
The SDK SHALL expose an abort mechanism. The Web application SHALL stop reading immediately when the visitor cancels, and the API SHALL propagate disconnection or abort to the active provider request where the upstream supports cancellation.

#### Scenario: Visitor stops generation
- **GIVEN** a chat stream is active
- **WHEN** the visitor selects stop
- **THEN** the UI stops appending content promptly
- **AND** the gateway finalizes the request as cancelled rather than successful

### Requirement: Comparison streams are isolated
The Chat page SHALL support concurrent comparison of two or three enabled text-model aliases. Each model SHALL have independent loading, content, usage, error, and cancellation state; one failed model MUST NOT stop or fail over another model.

#### Scenario: One comparison model fails
- **GIVEN** three comparison streams are active
- **WHEN** one provider returns an error
- **THEN** only that model column shows the normalized error
- **AND** the remaining streams continue to completion

### Requirement: Public chat limits are enforced before provider calls
The gateway SHALL enforce a configurable default limit of 10 Chat calls per source IP per 60 seconds and SHALL reject `max_tokens` above 4096. A rejected request MUST NOT invoke a provider.

#### Scenario: IP exceeds chat limit
- **GIVEN** one source IP has consumed its configured Chat allowance
- **WHEN** it submits another Chat request in the same window
- **THEN** the API returns 429 with retry information
- **AND** no provider adapter is called
