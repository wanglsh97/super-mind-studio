## MODIFIED Requirements

### Requirement: Model selection updates the current Thread without interrupting independent background Runs

For an existing idle Thread, the Agent model selector SHALL update that Thread immediately through the typed SDK and SHALL NOT create or navigate to a new Thread. The selector SHALL remain disabled while that Thread has an active Run, including waiting-for-user and cancelling states, but Runs in other Threads MUST NOT disable it. A failed update SHALL restore the confirmed model and expose an actionable error. Background Runs SHALL continue when the user navigates away and SHALL remain recoverable from persisted event sequences.

#### Scenario: Switch model in the current idle Thread

- **GIVEN** the user is viewing an idle Qwen Thread
- **WHEN** the user selects GLM
- **THEN** Web immediately calls the Thread model update API
- **AND** confirms GLM only after the API succeeds
- **AND** remains on the same Thread with the existing transcript

#### Scenario: Model update fails

- **GIVEN** the current Thread is confirmed as Qwen
- **WHEN** a GLM update request fails
- **THEN** the selector returns to Qwen
- **AND** Web displays the normalized error
- **AND** no new Thread is created

#### Scenario: Current Thread is active

- **GIVEN** the current Thread has a running, cancelling or waiting-for-user Run
- **WHEN** the model selector is rendered
- **THEN** the selector is disabled until that Run reaches a terminal state

#### Scenario: Another Thread runs in the background

- **GIVEN** Thread A has an active background Run and current Thread B is idle
- **WHEN** the user switches Thread B's model or starts a Run in Thread B below the user limit
- **THEN** Thread B remains interactive
- **AND** Thread A continues without cancellation or state mixing

#### Scenario: Return to a background Run

- **GIVEN** the user navigated away from an active Thread and its server Run continued
- **WHEN** the user reopens that Thread
- **THEN** Web reconnects from the last persisted sequence
- **AND** restores later events without duplicating or mixing events from other Threads

#### Scenario: Refresh with multiple active Threads

- **GIVEN** up to five owned Threads have active Runs
- **WHEN** the user refreshes the Agent workspace
- **THEN** the Thread list restores every active Run summary
- **AND** each Thread exposes independent status and cancellation
