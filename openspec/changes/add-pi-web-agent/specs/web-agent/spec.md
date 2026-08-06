## ADDED Requirements

### Requirement: Authenticated users can create a model-bound Agent thread
The system SHALL provide `/agent` to authenticated GitHub users and SHALL create each Agent thread with one enabled model instance that declares Agent/tool-calling capability. The selected model MUST remain immutable for that thread; selecting another model SHALL create another thread. Existing `/chat`, `/image`, and `/prompt` behavior MUST remain independent.

#### Scenario: Create an Agent thread with a capable model
- **GIVEN** an authenticated user selects an enabled model with Agent capability
- **WHEN** the user creates a thread
- **THEN** the system persists a thread owned by that user and bound to the selected model

#### Scenario: Reject a non-Agent model
- **GIVEN** a model can serve ordinary Chat but does not declare Agent capability
- **WHEN** a client attempts to create an Agent thread with that model
- **THEN** the server rejects the request without creating a thread or invoking a provider

#### Scenario: Switch model by creating another thread
- **GIVEN** an existing thread is bound to model A
- **WHEN** the user selects model B from the Agent model picker
- **THEN** the Web application creates a new thread bound to model B and preserves the original thread unchanged

### Requirement: Pi harness orchestrates Agent runs on the server
The NestJS Agent module SHALL run the Pi harness on the server and SHALL use a provider-neutral internal model invocation port for model calls. The browser and public SDK MUST NOT receive provider credentials, Pi runtime objects, or provider-specific response types.

#### Scenario: Complete a tool-assisted run
- **GIVEN** a user submits a prompt that requires `web_fetch`
- **WHEN** the model emits a valid tool call
- **THEN** the server executes the registered tool, appends its result to the Pi Agent context, performs a follow-up model turn, and persists the final answer

#### Scenario: Unknown tool call
- **GIVEN** the model requests a tool that is not present in the server registry
- **WHEN** the harness processes the tool call
- **THEN** the server records a failed tool result and continues or terminates according to the bounded Agent loop without executing arbitrary code

### Requirement: Agent runs expose replayable ordered events
Creating an Agent run SHALL return a run resource independently of its SSE connection. Every user-visible text, reasoning, tool, usage, status, and terminal update SHALL have a monotonically increasing sequence persisted before or atomically with publication. The SSE response SHALL emit an idle heartbeat frequently enough to remain open through the same-origin Web proxy. A client SHALL treat EOF before `[DONE]` as an interrupted stream, reconnect with its last sequence within a bounded retry policy, and receive later events without duplicating earlier events.

#### Scenario: Reconnect after browser interruption
- **GIVEN** an Agent run continues after the browser loses its SSE connection
- **WHEN** the user reopens the thread with the last received sequence
- **THEN** the SDK receives all later persisted events in order and reconstructs the current run state

#### Scenario: Browser disconnect does not cancel
- **GIVEN** an Agent run is active
- **WHEN** its event-stream connection closes without an explicit cancel request
- **THEN** the server continues the run until a terminal condition or configured limit

#### Scenario: Long tool execution produces no business event
- **GIVEN** an Agent tool runs longer than the Web proxy idle timeout
- **WHEN** no text, reasoning or tool result event is ready
- **THEN** SSE heartbeats keep the connection alive without advancing the event sequence or appearing as message content

#### Scenario: Event stream ends before protocol completion
- **GIVEN** the browser has received sequence N but has not received `[DONE]`
- **WHEN** the transport reaches EOF or a retryable network failure
- **THEN** the SDK reconnects with `after=N` and either reaches an explicit run terminal event or surfaces a bounded error instead of leaving the UI running forever

### Requirement: Agent runs are cancellable and terminal states are explicit
The system SHALL provide an idempotent cancel operation and SHALL propagate cancellation best effort to the active model stream and tool request. A run SHALL end in one explicit terminal state including succeeded, failed, cancelled, limit_reached, or interrupted.

#### Scenario: User cancels an active fetch
- **GIVEN** `web_fetch` is running for an active Agent run
- **WHEN** the owner cancels the run
- **THEN** the server aborts the fetch best effort, persists cancelled tool and run events, and performs no further model call

#### Scenario: API starts with an abandoned run
- **GIVEN** a previous API process ended while a run was active
- **WHEN** the API starts
- **THEN** the system marks the abandoned run interrupted and does not automatically replay its model or tool calls

### Requirement: Agent execution is bounded server-side
Each Agent run SHALL enforce authoritative configurable limits with defaults of six model calls, eight total tool calls, five `web_fetch` calls, and 120 seconds total duration. Reaching a limit MUST stop new work and MUST produce a visible `limit_reached` result.

#### Scenario: Web fetch call limit is reached
- **GIVEN** an Agent run has completed five `web_fetch` calls
- **WHEN** the model requests another `web_fetch`
- **THEN** the server refuses the call, makes no outbound request, and terminates the run with the reached limit identified

#### Scenario: Total duration is reached
- **GIVEN** a run reaches its configured duration limit
- **WHEN** a model call or tool request is active
- **THEN** the server aborts active work best effort and persists a `limit_reached` terminal event

### Requirement: Provider reasoning remains distinct from tool execution
The system SHALL persist reasoning only when the provider protocol explicitly returns reasoning content. Reasoning SHALL remain a distinct limited-size message part, visible only to the thread owner, sanitized, and excluded from ordinary assistant text sent into later model turns. The Agent page SHALL group reasoning and intermediate progress text before the final tool call into one thought disclosure while rendering tool calls separately in event order. The harness SHALL start a tool only after the model assistant message that requested it has ended. While a tool is running, the UI SHALL identify the phase as execution rather than thinking. The system MUST NOT fabricate reasoning for models that do not provide it.

#### Scenario: Thinking and execution are separate stages
- **GIVEN** an active Agent run emits reasoning, intermediate text, and tool calls
- **WHEN** the Agent page renders the response
- **THEN** reasoning and intermediate text appear in one thought disclosure while each tool appears outside it as an ordered execution card

#### Scenario: Tool starts after the model turn ends
- **GIVEN** a model emits reasoning followed by a valid tool call
- **WHEN** the harness accepts the assistant message
- **THEN** the event order records the assistant message end before the tool running status and the UI no longer labels that interval as thinking

#### Scenario: Completed thought remains reviewable
- **GIVEN** a visible thought disclosure belongs to a running Agent response
- **WHEN** the response reaches a terminal state
- **THEN** final answer text remains visible separately and the user can independently review the thought disclosure and tool execution cards

#### Scenario: Model provides tools without reasoning
- **GIVEN** the selected model emits tool events and final text but no provider reasoning
- **WHEN** the Agent page renders the response
- **THEN** tool execution cards appear without an empty thought disclosure and final text appears separately without artificial reasoning text

#### Scenario: Model provides neither tools nor reasoning
- **GIVEN** the selected model emits only a final text answer
- **WHEN** the Agent page renders the response
- **THEN** the page renders the answer without an empty thought disclosure

### Requirement: Agent usage and cost are auditable
Every internal model invocation SHALL create its own RequestLog and one-to-one BillingRecord after normal validation and rate-limit checks. The AgentRun SHALL aggregate model-call count, usage, and estimated CNY cost across its invocations without replacing the underlying records.

#### Scenario: Two-turn tool-assisted run is billed
- **GIVEN** one Agent run invokes a model, executes `web_fetch`, and invokes the model again
- **WHEN** the run succeeds
- **THEN** two request lifecycle records exist and the Agent run exposes their aggregated usage and estimated cost
