# Agent Tool Error Resilience

## ADDED Requirements

### Requirement: Tool failures are normalized into model-visible results

The Agent tool execution boundary MUST convert unknown tools, invalid arguments, cancellation,
MCP/Sandbox failures, and uncaught tool implementation exceptions into a structured failed tool
result. A single tool failure MUST NOT reject the Agent loop.

#### Scenario: An implementation throws an unknown exception

- **GIVEN** a registered tool throws a non-domain `Error`
- **WHEN** Pi executes the tool
- **THEN** the model receives one `isError: true` tool result
- **AND** the result has a stable fallback error code and useful message
- **AND** the Agent may continue to the next model turn

#### Scenario: A tool name is not registered

- **GIVEN** the model requests a tool outside the run-scoped registry
- **WHEN** the tool call is executed
- **THEN** no tool implementation or outbound request is invoked
- **AND** the model receives a normalized failed tool result

### Requirement: Tool errors preserve structured diagnostics

The tool result MUST keep separate model-facing content, UI summary, retryability and audit data.
The primary error code MUST come from structured data; text parsing MAY only be a compatibility
fallback. Credentials and sensitive headers MUST NOT enter any result or audit projection.

#### Scenario: A known Sandbox error is returned

- **GIVEN** a tool detects a timeout or missing file
- **WHEN** it returns a failed result
- **THEN** the model receives a specific corrective message
- **AND** the UI receives a short summary
- **AND** audit contains the stable code and retryability without secrets

### Requirement: Tool execution supports preparation and policy boundaries

The registry MUST support optional argument preparation before schema validation and a server-side
before-execution policy after validation. A rejected call MUST become a failed tool result and MUST
NOT execute the tool.

#### Scenario: A model serializes a compatible argument incorrectly

- **GIVEN** a tool provides a safe argument preparation function
- **WHEN** the model supplies the known serialized form
- **THEN** preparation runs before schema validation
- **AND** the normalized arguments are passed to the tool

#### Scenario: A policy rejects a dangerous call

- **GIVEN** server-side policy rejects the validated tool arguments
- **WHEN** the call reaches the policy boundary
- **THEN** the tool is not executed
- **AND** the model receives the rejection reason as `isError: true`

### Requirement: Tool progress is ordered and bounded by execution lifetime

Long-running tools MUST be able to emit progress updates. Updates emitted after the tool settles
MUST be ignored, and queued updates MUST be delivered before the final tool result.

#### Scenario: A tool fails after emitting progress

- **GIVEN** a tool emits progress and then throws
- **WHEN** the execution boundary handles the exception
- **THEN** queued progress is published before the failed tool result
- **AND** later orphan updates are ignored

### Requirement: Side-effecting tools declare safe execution mode

Tools with filesystem, export, skill activation or other conflicting side effects MUST declare or
enforce sequential execution. Read-only independent tools MAY execute in parallel. Tool result
messages MUST remain correlated to their original tool call IDs.

#### Scenario: Two conflicting writes are requested in one model turn

- **GIVEN** two calls target a conflicting side-effecting resource
- **WHEN** Pi schedules the batch
- **THEN** the calls execute without overlapping mutation
- **AND** each result is persisted against its own tool call ID

### Requirement: Run finalization closes incomplete tool calls

Before publishing a terminal run event, the service MUST compensate every tool call that is still
running. The compensation MUST include a stable interruption or cancellation code and MUST be
persisted and published exactly once.

#### Scenario: Agent runtime fails before tool end

- **GIVEN** a tool start event was persisted but no tool end event was received
- **WHEN** the Agent run is finalized as failed or cancelled
- **THEN** the incomplete tool call receives a terminal failed/cancelled result
- **AND** no `RUNNING` tool call remains in the final snapshot
- **AND** terminal run events are published after the compensation is persisted
