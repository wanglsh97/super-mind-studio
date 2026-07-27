## ADDED Requirements

### Requirement: Platform configuration owns MCP connections

The system SHALL load MCP Servers only from validated server-side configuration and SHALL NOT accept
server URLs, headers, credentials or remote tool names from the browser or model.

#### Scenario: No MCP configuration exists

- **GIVEN** `AGENT_MCP_SERVERS_JSON` is empty
- **WHEN** the API starts and an Agent run is created
- **THEN** no generic MCP connection is attempted
- **AND** existing built-in Agent tools remain available

#### Scenario: Bearer authentication is configured

- **GIVEN** a configured Server references a bearer token environment variable
- **WHEN** discovery or invocation occurs
- **THEN** NestJS resolves and sends the token
- **AND** the token, token environment name, endpoint and headers are absent from Prompt, API, audit and logs

### Requirement: MCP discovery is bounded and allowlisted

The system MUST use MCP Streamable HTTP initialize and paginated `tools/list`, MUST enforce discovery
timeouts and caps, and MUST expose only the intersection of remotely discovered tools and the platform
allowlist.

#### Scenario: An allowed remote tool is discovered

- **GIVEN** Server `docs` allows remote tool `lookup`
- **WHEN** `tools/list` returns a valid `lookup` object schema
- **THEN** the run tool registry contains `mcp__docs__lookup`
- **AND** the original endpoint and authentication are not model-visible

#### Scenario: The Server returns an unlisted tool

- **GIVEN** the remote Server also returns `delete_all`
- **WHEN** discovery completes
- **THEN** `delete_all` is absent from the Agent registry and Prompt

#### Scenario: One Server fails discovery

- **GIVEN** multiple MCP Servers are configured
- **WHEN** one times out
- **THEN** that Server contributes no tools and reports `error`
- **AND** other MCP Servers and built-in tools remain usable

### Requirement: MCP tool calls use immutable run-scoped definitions

Each Agent run SHALL resolve MCP tools once before Prompt composition and SHALL use the same combined
tool definitions for Prompt, context budgeting, model invocation and execution.

#### Scenario: Remote discovery changes during a run

- **GIVEN** a run started with `mcp__docs__lookup`
- **WHEN** the remote Server later changes its tool list
- **THEN** the active run keeps its original tool set
- **AND** a later run may observe the new discovery result

### Requirement: MCP invocation is cancellable, bounded and auditable

The system MUST propagate Agent cancellation, enforce time and output limits, wrap MCP output as
untrusted external data, and persist a credential-free tool lifecycle.

#### Scenario: A tool succeeds

- **GIVEN** the model invokes a registered namespaced MCP tool
- **WHEN** the remote Server returns text content
- **THEN** the result is wrapped as untrusted MCP content and returned to the Agent
- **AND** `AgentToolCall` records the namespaced name, success, server ID, remote tool name, duration and truncation

#### Scenario: A caller cancels an invocation

- **GIVEN** an MCP tool request is in progress
- **WHEN** the Agent run is cancelled
- **THEN** the outbound call is aborted and the client is closed
- **AND** a normalized cancelled tool result is emitted without retrying

### Requirement: MCP status is visible without secrets

Authenticated users SHALL be able to query a read-only projection of configured MCP Server readiness.

#### Scenario: Agent page loads MCP status

- **GIVEN** the current user is authenticated
- **WHEN** the Agent page requests MCP status
- **THEN** it receives Server identity, readiness, discovered/allowed tool counts and normalized error
- **AND** it receives no URL, auth mode, header, token or token environment name

### Requirement: MCP V1 excludes unsupported authority

V1 SHALL reject write/destructive MCP risk configuration and SHALL NOT implement user-managed Server
CRUD, OAuth, stdio, resources, prompts, sampling or elicitation.

#### Scenario: A destructive tool is configured

- **GIVEN** an operator marks an MCP tool destructive
- **WHEN** environment validation runs
- **THEN** startup fails before any MCP connection is attempted
