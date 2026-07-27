## MODIFIED Requirements

### Requirement: Agent tools are registered through a server allowlist

The Agent runtime SHALL resolve every model tool call through a server-owned Tool registry. `activate_skill`, Shell, Skill file and `export_file` tools SHALL define stable names, English descriptions, JSON Schema parameters, abort handling and serializable results. The registry SHALL authorize `activate_skill` against the current user's added published Skills, SHALL route Shell/file execution through `SandboxRuntimePort`, and SHALL allow `export_file` to persist only files under `/workspace/output` owned by the current Run. Model-supplied names or parameters MUST NOT select an unregistered tool, another user's Skill, an arbitrary OSS object or execution outside the current Thread sandbox.

#### Scenario: A valid Shell call is routed to the sandbox

- **GIVEN** a published added Skill is active and Shell arguments pass schema validation
- **WHEN** the Pi harness prepares the tool call
- **THEN** the registry delegates it to the current Thread sandbox under the current Run budget and persists its lifecycle and bounded result

#### Scenario: An unknown Skill is requested

- **GIVEN** the model calls `activate_skill` for a name the user has not added
- **WHEN** the registry authorizes the call
- **THEN** no package is downloaded, the existing Thread sandbox remains unchanged, and a normalized failed tool result is returned

### Requirement: Tool execution is visible and auditable

The Agent event stream SHALL expose tool start, bounded progress, success, failure, cancellation and result summary. Skill activation audit SHALL include Skill ID, name and observed package SHA-256. Shell audit SHALL include sandbox ID, command, working directory, exit status, duration, truncation, resource-limit reason and bounded stdout/stderr metadata. File audit SHALL include logical file ID, direction, size and hash while excluding signed URLs and credentials.

Persisted `write_file` arguments MUST omit file content and retain only bounded metadata. A successful `export_file` result SHALL emit a replayable `file-operation` event containing the stable file ID, output path, size and SHA-256.

#### Scenario: A user observes a successful Skill command

- **GIVEN** an active Skill runs a command successfully
- **WHEN** the page consumes ordered Agent events
- **THEN** it shows the Skill, command, running and completed states, exit status and concise output without exposing infrastructure credentials

### Requirement: Skill and MCP extension ports exist without active integrations

The Agent composition layer SHALL continue to isolate Skill and MCP integrations behind explicit ports. The Skill port SHALL now resolve the current user's published added and active Skills, while MCP MAY remain empty. The runtime MUST NOT scan host directories or execute Skill code outside `SandboxRuntimePort`.

#### Scenario: Agent starts with uploaded Skills enabled

- **GIVEN** the Skill repository, OSS adapter and Sandbox runtime are configured
- **WHEN** the Agent composes a Run for a user with added Skills
- **THEN** it resolves candidates through the Skill port without scanning local directories or changing the MCP registry
