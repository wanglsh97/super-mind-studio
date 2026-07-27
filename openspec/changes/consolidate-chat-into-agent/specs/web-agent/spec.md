## MODIFIED Requirements

### Requirement: Authenticated users can create a model-bound Agent thread

The system SHALL provide `/agent` as the canonical authenticated user surface for both ordinary model conversation and multi-step tool-assisted work. Each Agent thread SHALL use one enabled model instance that declares Agent/tool-calling capability. The selected model MUST remain immutable for that thread; selecting another model SHALL create another thread. The Agent surface SHALL expose the separate multi-model comparison experience as a sub-entry without changing comparison isolation semantics.

#### Scenario: Start an ordinary conversation

- **GIVEN** an authenticated user wants a direct text answer without requiring a tool
- **WHEN** the user opens the primary conversation entry
- **THEN** the Web application opens `/agent`
- **AND** the response is persisted in the user's Agent thread

#### Scenario: Open multi-model comparison from Agent

- **GIVEN** an authenticated user is on `/agent`
- **WHEN** the user selects the model-comparison action
- **THEN** the Web application opens the existing isolated comparison page
- **AND** returning from comparison opens `/agent`

#### Scenario: Switch model by creating another thread

- **GIVEN** an existing thread is bound to model A
- **WHEN** the user selects model B from the Agent model picker
- **THEN** the Web application creates a new thread bound to model B and preserves the original thread unchanged
