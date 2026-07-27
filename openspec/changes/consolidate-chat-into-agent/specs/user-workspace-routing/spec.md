## ADDED Requirements

### Requirement: Ordinary Chat navigation resolves to Agent

The user workspace SHALL present `/agent` as the only primary navigation item for ordinary conversation and Agent tasks. The homepage primary CTA and authentication fallback SHALL target `/agent`. `/chat` MUST NOT render a separate Chat application and SHALL redirect to `/agent` for compatibility.

#### Scenario: User opens an old Chat bookmark

- **GIVEN** a user has a bookmark for `/chat`
- **WHEN** the route is requested
- **THEN** Next.js redirects the user to `/agent`
- **AND** the retired Chat client bundle is not rendered

#### Scenario: Login has no valid return target

- **GIVEN** a login request has no return target or contains an unapproved target
- **WHEN** the Web application sanitizes the return path
- **THEN** it returns `/agent`

### Requirement: Multi-model comparison remains an Agent sub-scenario

The existing `/chat/compare` route SHALL remain available to authenticated users until a dedicated route migration is specified. It SHALL be reachable from `/agent`, SHALL visually activate the Agent navigation group, and SHALL return to `/agent`.

#### Scenario: User compares models

- **GIVEN** an authenticated user opens model comparison from Agent
- **WHEN** the comparison page renders
- **THEN** its independent per-model request behavior remains unchanged
- **AND** the page provides a return action to `/agent`

### Requirement: The C-end workspace is dedicated to Agent

The user-facing workspace SHALL NOT expose standalone Image or Prompt optimization pages or primary navigation items. `/image` and `/prompt` SHALL have no Next.js page implementation and SHALL return not found rather than redirecting. The underlying Gateway API and SDK capabilities MAY remain available for Agent integration, API demonstration, and administrative observability.

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

#### Scenario: User signs in without an allowed return target

- **GIVEN** a login return target is `/image`, `/prompt`, or another retired or unapproved route
- **WHEN** the Web application sanitizes it
- **THEN** the user is returned to `/agent`
