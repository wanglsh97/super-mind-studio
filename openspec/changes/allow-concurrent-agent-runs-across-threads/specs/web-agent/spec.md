## MODIFIED Requirements

### Requirement: Agent runs expose replayable ordered events

Creating an Agent run SHALL return a run resource independently of its SSE connection. Every
user-visible text, reasoning, tool, usage, status, and terminal update SHALL have a monotonically
increasing sequence persisted before or atomically with publication. A client SHALL be able to
reconnect with its last sequence and receive later events without duplicating earlier events. The
Thread list SHALL expose all active runs owned by the current user so the Web application can restore
per-Thread running state when multiple different Threads execute concurrently.

#### Scenario: Reconnect one of multiple active threads

- **GIVEN** one user has active runs in threads A and B
- **WHEN** the user refreshes and opens thread A with its last received sequence
- **THEN** the SDK restores both active-run summaries
- **AND** receives thread A's later persisted events in order without mixing thread B's events

#### Scenario: Browser disconnect does not cancel background runs

- **GIVEN** a user has active runs in different threads
- **WHEN** an event-stream connection closes without an explicit cancel request
- **THEN** each server run continues independently until its own terminal condition or configured limit
