## ADDED Requirements

### Requirement: Website delivery uses one mode-scoped tool
The server-owned Agent tool registry SHALL expose `create_website` only to a run whose request mode is `website`. The tool SHALL accept no user-selected command or filesystem path and SHALL perform the fixed build, validation, ZIP archival and temporary preview workflow for `/workspace/work`.

#### Scenario: Website run receives the delivery tool
- **GIVEN** an authenticated GitHub user starts an Agent run with `mode: website`
- **WHEN** the run-scoped tool registry is assembled
- **THEN** it contains `create_website` together with the existing general tools needed to inspect and edit the Sandbox

#### Scenario: Normal Chat run is assembled
- **GIVEN** a run has no website mode
- **WHEN** the run-scoped tool registry is assembled
- **THEN** it does not contain `create_website` or the built-in website Skill instructions

### Requirement: The delivery tool is the website success authority
`create_website` SHALL execute the fixed production build, validate the static output, generate `source.zip` and `dist.zip`, archive them and return an owner-scoped temporary preview path before reporting success. A shell command, model text or generic `export_file` result alone MUST NOT transition the website Creation to succeeded.

#### Scenario: Build fails
- **GIVEN** the current project does not pass `pnpm build -- --base=./`
- **WHEN** the Agent calls `create_website`
- **THEN** the tool returns a bounded actionable failure without replacing the last successful artifacts and the Agent remains responsible for fixing and retrying

#### Scenario: Delivery succeeds
- **GIVEN** the project builds to a valid static `dist`
- **WHEN** `create_website` completes all validation and archive steps
- **THEN** it atomically makes the new artifacts current and returns project, run, artifact, build-time and same-origin preview metadata without any OSS or Sandbox signing credential
