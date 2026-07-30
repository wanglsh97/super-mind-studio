## ADDED Requirements

### Requirement: Kimi is exposed through a stable provider-neutral alias
The SDK and gateway SHALL expose `kimi` as a stable text-model alias while the actual Moonshot model ID, enabled state, API Key, and Base URL remain server-side configuration.

#### Scenario: Actual Kimi model changes
- **GIVEN** `KIMI_MODEL_ID` changes between deployments
- **WHEN** a client continues requesting alias `kimi`
- **THEN** the public request contract remains unchanged
- **AND** the request log records alias `kimi`, provider `kimi`, and the configured actual model ID

### Requirement: Kimi uses the shared stream transport with provider-owned mapping
The Kimi Adapter MUST own Moonshot authentication, request mapping, delta mapping, usage mapping, finish mapping, error mapping, and request-ID mapping while reusing the shared OpenAI-compatible HTTP/SSE transport.

#### Scenario: Successful Kimi stream
- **GIVEN** a sanitized Moonshot stream fixture containing content, usage, finish, and `[DONE]`
- **WHEN** the Kimi Adapter processes the stream
- **THEN** it emits ordered platform delta, usage, and finish events
- **AND** it never exposes the upstream API Key

#### Scenario: Kimi request is cancelled
- **GIVEN** a Kimi stream is in progress
- **WHEN** the caller aborts its signal
- **THEN** the upstream Fetch request is aborted
- **AND** the Adapter propagates an `AbortError` rather than a provider failure

### Requirement: Kimi credentials remain outside source control
The system MUST read `KIMI_API_KEY` from runtime environment configuration and MUST NOT include a real Moonshot credential in tracked files, browser bundles, logs, fixtures, or error responses.

#### Scenario: Kimi is disabled or unconfigured
- **GIVEN** no Kimi API Key is present
- **WHEN** default tests, CI, or the explicit smoke command starts
- **THEN** default tests use only fixtures
- **AND** the smoke command fails before making an external request

### Requirement: Real Kimi acceptance is explicit and low cost
The project SHALL provide an explicit real-provider smoke command that requests no more than 16 output tokens and is excluded from default tests and CI.

#### Scenario: Real Kimi smoke succeeds
- **GIVEN** a newly generated Moonshot API Key and an accessible configured model ID exist only in local runtime environment
- **WHEN** the operator runs the Kimi smoke command explicitly
- **THEN** the command receives at least one content delta, one usage result, and one finish event
- **AND** the command does not print the API Key
