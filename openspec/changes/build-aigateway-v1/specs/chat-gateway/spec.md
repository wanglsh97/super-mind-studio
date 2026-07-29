## ADDED Requirements

### Requirement: Agent is the only C-end conversation contract
The C-end SHALL use the authenticated persistent Agent thread/run/event APIs for ordinary conversation and multi-step tool work. The product MUST NOT expose a standalone Chat page, comparison page, SDK `chat.stream/compare` surface, or `POST /api/v1/chat/completions` endpoint. `/chat` MAY redirect to `/` only for legacy bookmarks.

#### Scenario: User starts an ordinary conversation
- **GIVEN** an authenticated user and an enabled Agent-capable model
- **WHEN** the user submits text from the root workspace
- **THEN** the Web application creates or continues an Agent thread and run through `@supermind/sdk`
- **AND** reasoning, text, tool activity and terminal state are projected through the recoverable Agent event stream
- **AND** no public Chat completions request is made

#### Scenario: Removed Chat API is probed
- **GIVEN** a client calls `POST /api/v1/chat/completions`
- **WHEN** NestJS resolves the route
- **THEN** no Chat controller handles the request
- **AND** the response is the platform's normalized not-found error

### Requirement: Selectable model instances are resolved through a repository catalog
The model gateway SHALL resolve stable public model instance IDs through a version-controlled repository catalog to a display name, provider adapter and upstream model ID. Runtime environment variables MUST NOT replace or mutate the catalog. Model discovery MAY expose reviewed metadata but MUST NOT expose credentials.

#### Scenario: Agent selects a configured model
- **GIVEN** an enabled model instance in the catalog
- **WHEN** an Agent thread is created with that model ID
- **THEN** the model gateway resolves its provider and upstream model
- **AND** persisted Agent and request records retain the public model ID, provider and resolved upstream model

### Requirement: Provider thinking is normalized for Agent
Qwen3.7-Plus, GLM-5.2, DeepSeek-V4-Pro and Kimi K3 SHALL run with their documented thinking mode and effort controls. Each adapter SHALL map streamed `reasoning_content` to the platform-neutral `reasoning` event without mixing it into final answer text.

#### Scenario: Provider streams reasoning before text
- **GIVEN** a thinking-capable configured provider
- **WHEN** the provider emits `reasoning_content` followed by `content`
- **THEN** the adapter emits ordered `reasoning` and `text` events
- **AND** the Agent stream projects them as independent reasoning and text message parts

#### Scenario: Tool call follows reasoning
- **GIVEN** a thinking model emits reasoning and a tool call
- **WHEN** the Agent submits the tool result in a follow-up model invocation
- **THEN** the complete associated reasoning content and tool call are replayed in provider-compatible fields
- **AND** the provider can continue without a missing-reasoning protocol error

### Requirement: Agent users control run-level thinking intensity
The Agent run contract SHALL accept only the provider-neutral `thinkingEffort` values `fast`, `balanced`, and `deep`. The three user-facing levels SHALL remain identical for every model while each Adapter maps them to supported vendor controls: Qwen SHALL use non-thinking or tiered `thinking_budget`; GLM and DeepSeek SHALL use non-thinking, `high`, or `max`; Kimi K3 SHALL use `low`, `high`, or `max` because it cannot disable thinking. The selected effort SHALL apply to every model invocation within the run, including tool follow-ups and context summarization, and vendor-specific fields SHALL remain confined to Adapters.

#### Scenario: User selects a thinking effort
- **GIVEN** an authenticated user selects `balanced` before sending an Agent task
- **WHEN** the Agent performs one or more model calls for that run
- **THEN** every invocation carries `thinkingEffort=balanced`
- **AND** each Adapter maps it to the provider's supported effort or budget control
- **AND** the UI keeps the same three effort choices when the selected model changes

#### Scenario: Invalid thinking effort is submitted
- **WHEN** a client submits a value other than `fast`, `balanced`, or `deep`
- **THEN** the Agent run API rejects it before creating or invoking the run

### Requirement: Agent model failover is bounded by the first content event
The model gateway SHALL attempt at most one configured fallback for an eligible timeout or upstream 5xx before any reasoning, text or tool-call event is emitted. It MUST NOT switch providers after the first content event.

#### Scenario: Primary fails before content
- **GIVEN** an Agent model invocation with a healthy configured fallback
- **WHEN** the primary fails with an eligible error before emitting reasoning, text or a tool call
- **THEN** the fallback handles the invocation without mixing provider output
- **AND** the request log records the failover

#### Scenario: Primary fails after reasoning begins
- **GIVEN** the primary has emitted a reasoning event
- **WHEN** its stream subsequently fails
- **THEN** the model gateway propagates the normalized error
- **AND** it does not invoke a fallback

### Requirement: Agent cancellation propagates best effort
The SDK and Web runtime SHALL stop consuming the active Agent run when the user cancels, and the API SHALL propagate the abort signal to the active provider and tool execution where supported.

#### Scenario: User stops a run
- **GIVEN** an Agent run is active
- **WHEN** the user selects stop
- **THEN** the UI stops appending events promptly
- **AND** the run and request lifecycle are finalized as cancelled rather than successful
