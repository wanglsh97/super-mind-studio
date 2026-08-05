## ADDED Requirements

### Requirement: Website generation uses explicit project output boundaries
The server-owned Agent tool registry SHALL provide website project tools that write only to the active Sandbox workspace, run the chosen build command and export only manifest-declared files under `/workspace/output`. Tool audit events SHALL include project ID, bounded command summary, status and artifact identifiers without credentials or raw OSS URLs.

#### Scenario: Agent exports project artifacts
- **GIVEN** an active website project has a valid output manifest
- **WHEN** the Agent requests project export
- **THEN** the registry verifies the declared files are regular files under the output boundary and records owner-scoped artifacts
