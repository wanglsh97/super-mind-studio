## ADDED Requirements

### Requirement: Agent can issue one durable structured question batch
The system SHALL register `ask_user_question` as a server-owned `read/none` Agent tool. A call SHALL contain one to four questions. Each question SHALL contain a short header, question text, two to four labelled options with descriptions, and a single- or multi-select indicator. The tool SHALL create one durable question batch and SHALL put the owning run into `waiting_for_user`; a run MUST NOT have more than one pending batch.

#### Scenario: Tool asks a valid batch
- **GIVEN** an active Agent run calls `ask_user_question` with schema-valid questions
- **WHEN** the tool is executed
- **THEN** the server persists the batch, publishes an ordered `user-question-asked` event, and waits without holding a database transaction

#### Scenario: A second batch is attempted while one is pending
- **GIVEN** an Agent run already has a pending question batch
- **WHEN** the model invokes `ask_user_question` again
- **THEN** the server returns a normalized failed tool result and creates no second batch

#### Scenario: Duplicate or overlong tool input is rejected
- **GIVEN** a tool call repeats a question or option label, exceeds a documented string bound, or otherwise violates the stable schema
- **WHEN** the server validates the call
- **THEN** it creates no question batch and returns a normalized failed tool result

### Requirement: User answers are complete, owner-scoped, and idempotent
The user interface SHALL always provide an Other custom-answer path. Every question in a batch MUST be answered before submission: a single-select question requires exactly one fixed option, a multi-select question requires one or more fixed options, or either kind MAY use Other exclusively by sending no option IDs and a non-empty `customText`. Fixed options and Other MUST NOT be combined. The server SHALL revalidate question uniqueness, option ownership, selection cardinality and Other semantics, scope mutation to the run owner, and atomically settle a batch by stable batch ID. The first valid settlement SHALL win; duplicate or competing submissions SHALL return the original settled result without creating another event.

#### Scenario: User submits complete answers
- **GIVEN** the authenticated run owner completes every question in a pending batch
- **WHEN** the answer request is submitted
- **THEN** the server persists answers, publishes `user-question-answered`, resumes the waiting tool, and returns the same result on retry

#### Scenario: Other is submitted as an explicit model-visible value
- **GIVEN** the authenticated run owner chooses Other for one question and enters non-empty custom text
- **WHEN** the answer request is submitted with an empty option ID list and that custom text
- **THEN** the server persists the custom answer and resumes the model with the explicit escaped text rather than an internal identifier

#### Scenario: Labels are returned to the model
- **GIVEN** the owner selects one or more fixed options
- **WHEN** the waiting tool resumes
- **THEN** its successful result contains the selected option labels and contains no platform-generated question or option UUID

#### Scenario: Continued model calls remain auditable after external tool data
- **GIVEN** the Agent continues after a submitted batch and a later external tool result contains a PostgreSQL-incompatible NUL character
- **WHEN** the next model invocation creates its required `RequestLog`
- **THEN** persistence escapes the NUL representation without altering the provider input, and the run continues instead of failing before provider invocation

#### Scenario: Incomplete or foreign answer is rejected
- **GIVEN** an answer omits a required selection or comes from a different user
- **WHEN** the answer request is submitted
- **THEN** no batch is settled and the waiting run remains unchanged

#### Scenario: Answer and skip race
- **GIVEN** two owner requests concurrently try to answer or skip the same pending batch
- **WHEN** both reach settlement
- **THEN** exactly one transition and one settlement event are committed and both callers observe the winning persisted result

### Requirement: Skipping is a successful model-visible outcome
The question card SHALL expose a Skip action. Skip SHALL settle the pending batch as a successful tool outcome, publish `user-question-skipped`, and return a model-visible instruction to continue with best judgment. Skip MUST NOT cancel the Agent run.

#### Scenario: User skips a batch
- **GIVEN** a pending batch belongs to the authenticated user
- **WHEN** the user selects Skip
- **THEN** the tool result tells the model that the user skipped the questions and the run may continue normally

### Requirement: Pending questions have no automatic timeout or restart recovery
The system SHALL not automatically expire a pending question batch. It SHALL remain pending until answered, skipped, or its run is cancelled. On API startup, a run in `waiting_for_user` SHALL be marked `interrupted` together with other active runs; its stale question card MUST NOT be returned or rendered, and the Pi loop MUST NOT be restored.

#### Scenario: Refresh restores a pending question
- **GIVEN** an active run is waiting for a pending question batch
- **WHEN** the owner refreshes or reconnects before settling it
- **THEN** thread detail returns the active pending batch and the Web application renders the same unanswered card

#### Scenario: Cancelling a waiting run invalidates its question
- **GIVEN** a run is waiting for user answers
- **WHEN** the owner cancels the run
- **THEN** the deferred tool is aborted, the batch becomes cancelled, and no pending card is returned

#### Scenario: API restarts while a question is pending
- **GIVEN** a run is waiting for user answers when the API process stops
- **WHEN** the API starts again
- **THEN** the run becomes interrupted and no pending question is shown to the user
- **AND** the pending batch becomes interrupted in the same cleanup operation
