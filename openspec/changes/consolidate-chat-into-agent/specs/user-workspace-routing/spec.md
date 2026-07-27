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
