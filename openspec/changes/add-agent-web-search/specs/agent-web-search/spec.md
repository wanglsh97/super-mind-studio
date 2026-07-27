## ADDED Requirements

### Requirement: Agent exposes one provider-neutral web search tool

The Agent SHALL expose a single `web_search` tool whose public model-facing contract does not reveal provider-specific tool names or authentication.

#### Scenario: Model searches the current web
- **GIVEN** Agent web search is enabled
- **WHEN** the model invokes `web_search` with a valid query
- **THEN** the server selects Exa or Parallel
- **AND** returns the provider result through the existing Agent tool-result lifecycle

#### Scenario: Search is disabled
- **GIVEN** `AGENT_WEB_SEARCH_ENABLED=false`
- **WHEN** the Agent prompt is composed
- **THEN** `web_search` is absent from the Tool registry and model-visible schema

### Requirement: Exa and Parallel use bounded remote MCP calls

The system MUST call the fixed Exa and Parallel MCP endpoints with JSON-RPC 2.0 `tools/call`, MUST accept JSON and SSE response forms, and MUST enforce cancellation, timeout, HTTP response-size and model-output limits.

#### Scenario: Exa is selected
- **GIVEN** provider `exa` and a valid search request
- **WHEN** the MCP request is built
- **THEN** it calls `web_search_exa`
- **AND** maps the provider-neutral query options without sending browser credentials

#### Scenario: Parallel is selected
- **GIVEN** provider `parallel` and a valid search request
- **WHEN** the MCP request is built
- **THEN** it calls `web_search`
- **AND** maps the query to `objective` and `search_queries`
- **AND** includes the current run ID when available

#### Scenario: Caller cancels search
- **GIVEN** an MCP request is in progress
- **WHEN** the Agent run AbortSignal is aborted
- **THEN** the outbound request is aborted
- **AND** the tool returns a normalized cancelled error without retrying another provider

### Requirement: Auto routing is stable and does not duplicate queries

The `auto` provider mode SHALL deterministically select one provider from the Agent run identity and SHALL NOT automatically fail over a search to the other provider.

#### Scenario: One run issues multiple searches
- **GIVEN** provider mode `auto`
- **WHEN** the same run invokes `web_search` more than once
- **THEN** every invocation selects the same provider

#### Scenario: Selected provider fails
- **GIVEN** provider mode `auto`
- **WHEN** the selected provider returns an error
- **THEN** the error is returned to the Agent as a tool error
- **AND** the query is not sent to the other provider

### Requirement: Anonymous free mode requires no API Key

The system SHALL support both providers without configured credentials and SHALL keep optional credentials server-side.

#### Scenario: No search credentials exist
- **GIVEN** neither `EXA_API_KEY` nor `PARALLEL_API_KEY` is configured
- **WHEN** environment validation and Agent startup complete
- **THEN** `web_search` remains available
- **AND** outbound MCP requests contain no Authorization header or credential query parameter

#### Scenario: Optional credential is configured
- **GIVEN** an operator later configures a provider credential
- **WHEN** its provider is called
- **THEN** the credential is applied only by the server-side provider adapter
- **AND** it is absent from tool results, audit metadata, errors, browser bundles and tracked files

### Requirement: Search content remains untrusted external data

The system MUST mark search results as untrusted, MUST NOT execute instructions found in results, and MUST NOT allow result content to extend the Tool allowlist or disclose credentials.

#### Scenario: Search result contains prompt injection
- **GIVEN** a provider result asks the Agent to reveal secrets or invoke an unknown tool
- **WHEN** the result is returned to the model
- **THEN** it is wrapped in the untrusted external source boundary
- **AND** the registry continues to reject tools outside the server allowlist

### Requirement: Real smoke is explicit, anonymous and bounded

The project SHALL provide a smoke command that performs exactly one small anonymous query against each provider and is excluded from default tests and CI.

#### Scenario: Anonymous endpoints are available
- **GIVEN** the operator explicitly runs the web-search smoke command
- **WHEN** Exa and Parallel return successful MCP results
- **THEN** the command reports provider, response size and a non-sensitive preview
- **AND** no API Key is requested, read or printed
