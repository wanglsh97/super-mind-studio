## ADDED Requirements

### Requirement: GitHub users can create a static web project through Agent
The system SHALL allow only an authenticated GitHub user to create a website project from an Agent conversation. It SHALL create an owner-scoped WebProject before the Agent starts generation and SHALL associate the project with the originating Agent thread and run.

#### Scenario: GitHub user starts a website project
- **GIVEN** a user has an authenticated GitHub session
- **WHEN** the user starts a website generation request
- **THEN** the system creates an owner-scoped project and starts an Agent run with the static-site instructions

#### Scenario: Anonymous user attempts website generation
- **GIVEN** a user has no GitHub-authenticated session
- **WHEN** the user attempts website generation
- **THEN** the API rejects the request without creating a sandbox or project and the UI presents a GitHub login action

### Requirement: Generated projects conform to the static delivery contract
The Agent SHALL be free to select a framework, but a completed project MUST contain a package manifest, dependency lockfile, repeatable build command and a static output directory. It MUST NOT require database access, server runtime, private environment variables, login, payment processing or a private upstream API to render its delivered website.

#### Scenario: Static build succeeds
- **GIVEN** the Agent has generated a project in its Sandbox workspace
- **WHEN** it executes the declared build command and produces the declared output directory
- **THEN** the project becomes eligible for preview and artifact export

#### Scenario: Project requires server execution
- **GIVEN** a generated project has no static output directory or declares a server-only runtime
- **WHEN** the delivery validator runs
- **THEN** the project is marked failed and the Agent does not claim a downloadable website is ready

### Requirement: Website source and build outputs remain downloadable after Sandbox destruction
The system SHALL archive a source ZIP and a static build ZIP from the explicit project output manifest to private OSS before ending a successful project. It SHALL never archive dependency caches, arbitrary Sandbox paths, platform secrets or persistent OSS URLs into Agent messages or database records.

#### Scenario: Successful project is archived
- **GIVEN** a project has passed the static delivery validation
- **WHEN** the Agent exports its source and build artifacts
- **THEN** its owner can download both assets using same-origin authorized routes after the Sandbox is destroyed

### Requirement: Website previews are private and temporary
The system SHALL proxy a generated static preview only to the project owner using a short-lived server-issued route. It MUST NOT expose a Sandbox port directly or provide a public share URL.

#### Scenario: Owner opens a preview
- **GIVEN** an owner has a completed project with an active preview
- **WHEN** the owner opens its preview route
- **THEN** the system proxies only that project's static content to the authenticated owner

#### Scenario: Another user opens a preview
- **GIVEN** a project belongs to user A
- **WHEN** user B requests its preview route
- **THEN** the system returns no project content
