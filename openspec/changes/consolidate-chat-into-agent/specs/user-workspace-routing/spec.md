## ADDED Requirements

### Requirement: Ordinary Chat navigation resolves to Agent

The user workspace SHALL render Agent directly at `/` as the only primary surface for ordinary conversation and Agent tasks. There SHALL be no separate marketing homepage or `/agent` page. Authentication fallback SHALL target `/`. `/chat` MUST NOT render a separate Chat application and SHALL redirect to `/` for compatibility.

#### Scenario: User opens an old Chat bookmark

- **GIVEN** a user has a bookmark for `/chat`
- **WHEN** the route is requested
- **THEN** Next.js redirects the user to `/`
- **AND** the retired Chat client bundle is not rendered

#### Scenario: Login has no valid return target

- **GIVEN** a login request has no return target or contains an unapproved target
- **WHEN** the Web application sanitizes the return path
- **THEN** it returns `/`

### Requirement: Multi-model comparison is retired

The C-end SHALL NOT register `/chat/compare` or expose a model comparison action. Authentication return-path allowlists MUST reject `/chat/compare` and fall back to `/`.

#### Scenario: User opens an old comparison URL

- **GIVEN** a user has an old `/chat/compare` link
- **WHEN** the route is requested
- **THEN** Next.js returns not found
- **AND** no comparison client bundle or public Chat request is loaded

### Requirement: The C-end workspace is dedicated to Agent

The user-facing workspace SHALL NOT expose standalone marketing, Agent alias, Image, Prompt optimization, or API showcase pages or primary navigation items. The root route SHALL render the authenticated Agent workspace directly. `/agent`, `/image`, `/prompt`, and the C-end `/api` page SHALL have no Next.js page implementation and SHALL return not found rather than redirecting. `/api` MAY return the API proxy's JSON not-found envelope because the proxy owns that prefix. The underlying `/api/v1/*` Gateway, Swagger, and SDK capabilities SHALL remain available for Agent integration, developer documentation, and administrative observability.

#### Scenario: User opens the root route

- **GIVEN** Agent is the only C-end workspace
- **WHEN** an authenticated user opens `/`
- **THEN** the Agent conversation workspace renders directly
- **AND** no marketing Hero or intermediate Agent link is rendered

#### Scenario: User opens the retired Agent alias

- **GIVEN** the Agent workspace has moved to `/`
- **WHEN** a user requests `/agent`
- **THEN** the request returns a not-found response without rendering a C-end page
- **AND** it does not redirect

#### Scenario: User opens a retired Image URL

- **GIVEN** the standalone Image page has been removed
- **WHEN** a user requests `/image`
- **THEN** Next.js returns its not-found response
- **AND** no Image form or local history code is loaded

#### Scenario: User opens a retired Prompt URL

- **GIVEN** the standalone Prompt optimization page has been removed
- **WHEN** a user requests `/prompt`
- **THEN** Next.js returns its not-found response
- **AND** no Prompt optimization form is rendered

#### Scenario: User opens the retired API showcase URL

- **GIVEN** the C-end API showcase page has been removed
- **WHEN** a user requests `/api`
- **THEN** the request returns a not-found response without rendering a C-end page
- **AND** requests under `/api/v1/*` remain governed by the existing Gateway proxy and API authentication

#### Scenario: User signs in without an allowed return target

- **GIVEN** a login return target is `/image`, `/prompt`, or another retired or unapproved route
- **WHEN** the Web application sanitizes it
- **THEN** the user is returned to `/`

### Requirement: The sidebar prioritizes conversation actions and recent history

The expanded user sidebar SHALL place a visually secondary new-conversation action directly below the product logo. It SHALL label the history section “对话” without rendering separate Agent or Skill navigation title cards. The history section SHALL show at most 5 most-recent threads by default and SHALL provide a control to reveal all remaining threads and collapse them again. The user-account menu SHALL provide the entry to `/skills`.

#### Scenario: User opens a sidebar with more than five conversations

- **GIVEN** an authenticated user has more than 5 Agent threads
- **WHEN** the expanded sidebar first renders
- **THEN** it displays the 5 most-recent threads
- **AND** it displays a control with the number of hidden threads

#### Scenario: User expands conversation history

- **GIVEN** additional threads are folded
- **WHEN** the user activates the expand control
- **THEN** all threads become visible
- **AND** the same control allows the history to be collapsed to 5 threads again

#### Scenario: User opens Skill management

- **GIVEN** the Skill card has been removed from the main sidebar
- **WHEN** an authenticated user opens the user-account menu
- **THEN** the menu contains a “技能” entry targeting `/skills`
