## MODIFIED Requirements

### Requirement: Skill and MCP extension ports isolate active integrations

The Agent composition layer SHALL isolate Skill and MCP integrations behind explicit ports. The Skill
port SHALL resolve the current user's published added Skills. The MCP port SHALL resolve only
platform-configured, allowlisted Streamable HTTP tools and SHALL keep endpoints and credentials
server-side. The runtime MUST NOT scan host directories, accept arbitrary MCP endpoints, or execute
tools outside the server-owned registry.

#### Scenario: Agent starts with MCP Servers configured

- **GIVEN** one or more valid platform MCP configurations exist
- **WHEN** the Agent composes a run
- **THEN** it resolves allowed remote tools through the MCP port
- **AND** merges them with built-in tools in a run-scoped allowlist
