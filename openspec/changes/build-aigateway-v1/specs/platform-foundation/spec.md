## ADDED Requirements

### Requirement: Monorepo provides one runnable product boundary
The system SHALL use a pnpm workspace containing the Next.js Web application, the NestJS API application, and one internal `@supermind/sdk` package. The Web application SHALL call public AI APIs through `@supermind/sdk` rather than importing provider SDKs or provider-specific response types.

#### Scenario: Workspace is installed and built
- **GIVEN** a clean checkout with the documented Node.js and pnpm versions
- **WHEN** the developer installs dependencies and runs the workspace build
- **THEN** Web, API, and SDK packages compile from one lockfile
- **AND** no provider SDK is required by the Web application

### Requirement: Shared contracts remain provider-neutral
The system SHALL define versioned request, response, error, model, usage, and task-state contracts that expose platform model aliases but do not expose provider wire types to Web or SDK consumers.

#### Scenario: Provider implementation changes
- **GIVEN** a provider adapter changes its upstream endpoint or payload shape
- **WHEN** the adapter is updated
- **THEN** existing Web calls and public SDK method signatures remain compatible

### Requirement: Configuration is validated at startup
The API SHALL validate required environment variables and model alias mappings before accepting traffic. Provider API keys SHALL be optional only when the corresponding provider is disabled, and secrets SHALL NOT be returned by health, model-list, log-list, or dashboard endpoints.

#### Scenario: Enabled provider has no API key
- **GIVEN** a real provider is marked enabled without its required API key
- **WHEN** the API starts
- **THEN** startup fails with a configuration error that names the missing variable without printing secret values

### Requirement: Deterministic Mock Adapter supports the first vertical slice
The system SHALL provide a deterministic Mock Adapter for development, tests, and CI that supports stream chunks, usage, completion, configured failures, configured delay, and cancellation without calling an external network.

#### Scenario: No provider key is available
- **GIVEN** Mock mode is enabled and no real provider API key exists
- **WHEN** a valid chat request is sent
- **THEN** the request completes through the same registry, service, SDK, SSE, and persistence path used by real adapters

### Requirement: Dependency health is explicit
The API SHALL expose liveness and readiness states for the application, PostgreSQL, and Redis. Readiness SHALL fail if PostgreSQL or Redis is unavailable because request logging and paid-call limiting are required on the main path.

#### Scenario: Redis becomes unavailable
- **GIVEN** the API process and PostgreSQL are running
- **WHEN** Redis cannot be reached
- **THEN** liveness remains available for process diagnosis
- **AND** readiness reports unavailable
- **AND** public paid model calls fail closed rather than bypassing rate limits

### Requirement: User capabilities share a responsive workspace shell
The user-facing Web application SHALL present Chat, Image, Skills, and API integration guidance in a shared workspace shell. On desktop, the shell SHALL provide a left sidebar with the Super Mind Studio brand at the top, capability navigation in the middle, user identity at the bottom, and a control that collapses the sidebar. On narrow screens, the same navigation SHALL be available as a dismissible drawer without causing horizontal page overflow. The administrator console MAY retain its independent navigation shell.

#### Scenario: User navigates capabilities on desktop
- **GIVEN** the user opens a user-facing capability page on a desktop viewport
- **WHEN** the workspace shell is rendered
- **THEN** Chat, Image, Skills, and API navigation is visible in the left sidebar
- **AND** the user can collapse and expand the sidebar
- **AND** authenticated user identity is shown at the bottom of the sidebar

#### Scenario: Skills server capability is not yet available
- **GIVEN** the server does not expose a Skills API
- **WHEN** the user opens the Skills page
- **THEN** the page displays installed-skill preview cards and clearly labels them as display-only
- **AND** it does not issue a Skills API request

#### Scenario: Developer reviews gateway integration options
- **GIVEN** the developer opens the API integration guidance page
- **WHEN** the page is rendered
- **THEN** it provides copyable SDK and cURL examples that match the current gateway contract
- **AND** it lists the available Chat, Image, Prompt, and Models endpoints
- **AND** it explains the user Session requirement without exposing a real credential
