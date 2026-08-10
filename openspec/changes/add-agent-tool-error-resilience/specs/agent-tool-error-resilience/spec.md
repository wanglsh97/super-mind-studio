# Agent Tool Error Resilience

## ADDED Requirements

### Requirement: Tool failures use a Pi-compatible structured exception

Every tool failure MUST be represented by `AgentToolExecutionError` with a stable code, concrete
natural-language string message, summary, retryable flag and optional audit metadata. Pi core remains
responsible for converting the thrown error into a failed tool result and deciding Agent control flow.

#### Scenario: A known tool failure is wrapped

- **GIVEN** a tool detects a missing file, timeout, non-zero exit or MCP failure
- **WHEN** it reports the failure
- **THEN** it throws `AgentToolExecutionError`
- **AND** the message explains why it failed and what recovery action is appropriate
- **AND** Pi receives the error through its native exception contract

#### Scenario: An unknown exception occurs

- **GIVEN** a tool throws an exception that is not a known domain error
- **WHEN** the Registry handles the exception
- **THEN** it wraps it as `AgentToolExecutionError` with fallback code `AGENT_TOOL_FAILED`
- **AND** the original cause is retained only for server-side logging

### Requirement: Error metadata remains separate from Pi message text

The exception MUST keep `code`, `summary`, `retryable` and `audit` separately from its string `message`.
The message MUST remain directly consumable by Pi. Business context MAY be extended, but a shared
boundary MUST redact secrets and enforce size and nesting limits.

#### Scenario: The model receives a corrective error

- **GIVEN** a file path is missing
- **WHEN** the error is thrown to Pi
- **THEN** the message is a concrete natural-language string
- **AND** it tells the model to inspect the directory and retry with an existing path
- **AND** the structured code and audit metadata remain available to project telemetry

### Requirement: Tool progress reuses the Pi partial result protocol

Long-running tools MUST be able to call Pi's `onUpdate(partial AgentToolResult)`. The project MUST
broadcast the resulting `tool_execution_update` best-effort over SSE only. Progress MUST NOT be
persisted or added to model history.

#### Scenario: A tool emits progress and then fails

- **GIVEN** a tool emits one or more partial results and then throws
- **WHEN** Pi handles the tool call
- **THEN** accepted progress MAY be delivered or dropped
- **AND** the final Pi tool result remains authoritative
- **AND** progress loss does not change the tool error or Agent control flow

#### Scenario: Progress broadcasting fails

- **GIVEN** the SSE event bus rejects a progress update
- **WHEN** the project handles the update
- **THEN** it records the observability failure
- **AND** it does not change the tool's final result or trigger a retry

### Requirement: Observability does not change Pi error semantics

The project MUST record tool invocation duration, status and normalized error code at the Registry
tool boundary. OTel or metric failures MUST NOT replace, swallow or reinterpret the original tool
exception.

#### Scenario: Telemetry fails during a tool error

- **GIVEN** a tool throws `AgentToolExecutionError`
- **WHEN** telemetry recording also fails
- **THEN** the original tool exception remains the one thrown to Pi
- **AND** no automatic tool replay occurs
