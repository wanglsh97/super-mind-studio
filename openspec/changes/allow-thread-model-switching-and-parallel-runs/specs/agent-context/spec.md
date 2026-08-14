## MODIFIED Requirements

### Requirement: Cross-model history remains portable without replaying foreign Provider reasoning

When a Thread changes models, subsequent Runs SHALL continue from the same persisted user messages, assistant final text, Tool Calls, Tool Results and current context summary. Provider reasoning SHALL remain persisted for owner display and audit, but reasoning produced by a different Provider MUST NOT be sent to the new Provider. Context budgeting SHALL use the new Run model's context window, and any later summary revision SHALL be generated through the new Run model.

#### Scenario: Thread switches across Providers

- **GIVEN** a Thread contains Qwen reasoning, final text, a Tool Call, its Tool Result and a context summary
- **WHEN** the owner switches the Thread to GLM and starts a new Run
- **THEN** GLM receives the portable user, final-text, Tool Call, Tool Result and summary context
- **AND** GLM does not receive Qwen reasoning content or Qwen-private fields
- **AND** the owner can still view the persisted Qwen reasoning in historical UI and audit data

#### Scenario: New model has a smaller context window

- **GIVEN** an existing Thread is switched to a model with a smaller context window
- **WHEN** the next Run prepares context
- **THEN** the platform recalculates the budget using the new model window
- **AND** invokes the existing bounded compression flow when required
- **AND** any new summary revision records the new model

#### Scenario: Existing summary remains reusable

- **GIVEN** a Thread has a valid context summary created before a model switch
- **WHEN** the model update succeeds
- **THEN** the platform does not immediately regenerate or discard that summary
- **AND** the next Run may reuse it subject to the new context budget

#### Scenario: Context still cannot fit

- **GIVEN** compression cannot fit the portable history within the new model window
- **WHEN** the next Run prepares context
- **THEN** the Run terminates with the existing context-limit semantics
- **AND** the Thread remains bound to the newly selected model
