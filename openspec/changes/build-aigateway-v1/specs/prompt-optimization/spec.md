## ADDED Requirements

### Requirement: Anonymous users can optimize a Prompt in three modes
The public Prompt page SHALL accept a source Prompt and one of `expand`, `simplify`, or `structure`, submit it through `@supermind/sdk`, and display a copyable optimized result without requiring login.

#### Scenario: Structure mode succeeds
- **GIVEN** a non-empty source Prompt and the structure mode
- **WHEN** the visitor submits optimization
- **THEN** `POST /api/v1/prompts/optimize` returns the optimized text, request ID, model alias, usage, and estimated CNY cost
- **AND** the visitor can copy the result

### Requirement: Optimization templates are controlled and versioned server-side
The API SHALL maintain a versioned server-side template for each optimization mode. Clients SHALL send only the source Prompt and mode and MUST NOT supply an arbitrary system Prompt through the optimization endpoint.

#### Scenario: Template version is upgraded
- **GIVEN** the server deploys a new version of the expand template
- **WHEN** an expand request is processed
- **THEN** the request record identifies the applied mode and template version for diagnosis

### Requirement: Prompt optimization reuses the chat provider registry
The optimization service SHALL use the same configured text-model adapter registry, normalized errors, logging, rate limiting, usage mapping, and billing calculation as Chat. The default optimizer model SHALL be configured by `PROMPT_OPTIMIZER_MODEL` rather than hard-coded.

#### Scenario: Default optimizer provider is disabled
- **GIVEN** the configured optimizer model alias is disabled
- **WHEN** a visitor submits optimization
- **THEN** the API returns a normalized service-unavailable error without silently selecting an undeclared model

### Requirement: Prompt page provides safe client conveniences
The Prompt page SHALL provide three predefined examples, support mode switching, prevent duplicate submissions while a request is active, and render model output as text or sanitized Markdown.

#### Scenario: Visitor uses a predefined example
- **GIVEN** the Prompt page is open
- **WHEN** the visitor selects an example
- **THEN** its text populates the input and remains editable before submission
