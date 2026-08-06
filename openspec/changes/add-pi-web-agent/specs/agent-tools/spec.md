## ADDED Requirements

### Requirement: Agent tools are registered through a server allowlist
The Agent runtime SHALL resolve every model tool call through a server-owned Tool registry. Each tool SHALL define a stable name, description, JSON Schema parameters, execution function, abort handling, and serializable result contract. Model-supplied tool names or parameters MUST NOT select arbitrary code, endpoints, headers, or credentials.

#### Scenario: Valid registered tool call
- **GIVEN** the model emits a registered tool name with schema-valid arguments
- **WHEN** the Pi harness prepares the tool call
- **THEN** the registry executes that tool and persists its lifecycle events and result

#### Scenario: Invalid arguments
- **GIVEN** the model emits `web_fetch` with arguments that fail its schema
- **WHEN** the harness validates the call
- **THEN** no outbound request occurs and a normalized failed tool result is returned to the Agent loop

### Requirement: web_fetch can retrieve arbitrary validated public URLs
The `web_fetch` tool SHALL allow the model to choose an HTTP or HTTPS URL without per-call user confirmation, provided every resolved connection target is a public network address. It MUST reject embedded credentials, localhost, private, link-local, multicast, reserved, unspecified, cloud metadata, non-HTTP protocols, and targets that cannot be proven public.

#### Scenario: Fetch a public HTTPS page
- **GIVEN** the model requests a syntactically valid HTTPS URL whose resolved addresses are public
- **WHEN** `web_fetch` executes
- **THEN** it performs a bounded credential-free request and returns normalized metadata and extracted text

#### Scenario: Reject a private target
- **GIVEN** a URL resolves to a loopback, private, link-local, reserved, or cloud metadata address
- **WHEN** `web_fetch` validates the destination
- **THEN** it fails closed before connecting and records a normalized blocked-target error

#### Scenario: Reject embedded credentials
- **GIVEN** a URL contains username or password components
- **WHEN** `web_fetch` validates the URL
- **THEN** it rejects the call without making a network request

### Requirement: Redirects cannot bypass destination validation
`web_fetch` SHALL handle redirects manually, SHALL repeat URL and DNS/address validation for every hop, and SHALL enforce a maximum of five redirects. It MUST NOT forward credentials or sensitive headers between redirects.

#### Scenario: Public page redirects to private address
- **GIVEN** an initially public URL returns a redirect to a private or metadata target
- **WHEN** `web_fetch` processes the redirect
- **THEN** it blocks the redirected request before connecting to the target

#### Scenario: Redirect limit is exceeded
- **GIVEN** a redirect chain exceeds five hops
- **WHEN** `web_fetch` reaches the configured limit
- **THEN** it stops and returns a normalized redirect-limit error

### Requirement: web_fetch does not execute active web content
The tool SHALL perform ordinary server-side HTTP requests without executing JavaScript, loading scripts, styles, images, iframe content, or other subresources. It SHALL accept only supported HTML, JSON, and textual content types and SHALL reject PDF, image, video, archive, and unknown binary content in V1.

#### Scenario: Extract an HTML article
- **GIVEN** a successful HTML response within the size limit
- **WHEN** `web_fetch` processes it
- **THEN** it extracts title and readable text into sanitized Markdown or plain text without executing scripts or requesting subresources

#### Scenario: Reject a PDF
- **GIVEN** the target responds with a PDF content type
- **WHEN** `web_fetch` processes the response
- **THEN** it stops reading and returns an unsupported-content error without passing binary content to the model

### Requirement: web_fetch enforces bounded resource use
The tool SHALL enforce configurable connection and total timeouts, a maximum response body of 2 MiB, and a maximum extracted result of 30,000 characters by default. It SHALL stop reading once a limit is exceeded and SHALL expose whether returned text was truncated.

#### Scenario: Oversized response
- **GIVEN** a response body exceeds 2 MiB
- **WHEN** `web_fetch` reads the stream
- **THEN** it aborts the request and returns a normalized size-limit error without buffering the remainder

#### Scenario: Extracted text is truncated
- **GIVEN** supported content is within the byte limit but extracted text exceeds 30,000 characters
- **WHEN** the result is prepared for the model
- **THEN** it returns the first bounded content with an explicit truncation indicator

### Requirement: Retrieved content is treated as untrusted data
The Agent system instructions and tool result envelope SHALL identify fetched content as untrusted reference data. Platform-authored tool descriptions, parameter descriptions, and trust-wrapper text SHALL be English while fetched content retains its source language. Instructions found in fetched content MUST NOT alter system instructions, expand the tool allowlist, disclose credentials, or bypass destination and run limits.

#### Scenario: Page contains a prompt injection
- **GIVEN** fetched content tells the Agent to ignore prior instructions and access a sensitive target
- **WHEN** the content is returned to the model
- **THEN** the content remains delimited as untrusted tool data and all subsequent tool calls remain subject to the same allowlist and network validation

### Requirement: Tool execution is visible and auditable
The Agent event stream SHALL expose tool start, bounded progress or status, success, failure, cancellation, and result summary. Tool execution SHALL begin only after the requesting assistant message ends. The Web SHALL render a compact execution card whose single collapsed summary row contains a readable tool name, current state and primary object, and toggles the disclosure when the user clicks anywhere on that row. Expanded content SHALL use tool-specific categories such as command, working directory, file, URL, parameters, execution summary and audit data instead of generic target/result labels, and SHALL not overflow narrow screens. For `web_fetch`, audit data SHALL include requested URL, final URL, status code when available, content type, bytes read, duration, truncation, and normalized error, while excluding credentials and sensitive response headers.

#### Scenario: User observes a successful fetch
- **GIVEN** `web_fetch` is called during an Agent run
- **WHEN** it starts and succeeds
- **THEN** the page shows the target, running state, final status, and a concise result summary in event order

#### Scenario: User observes a long-running shell command
- **GIVEN** a shell command is executing after the model turn has completed
- **WHEN** its tool card is visible
- **THEN** the card labels the phase as execution, keeps the command readable without horizontal page overflow, and updates the same card to its terminal state

#### Scenario: Website bootstrap exceeds one minute
- **GIVEN** a fresh website sandbox must install its fixed frontend dependencies
- **WHEN** the bootstrap command runs longer than 60 seconds but remains within the bounded command budget
- **THEN** the sandbox allows up to 180 seconds for that command while the Agent run remains protected by its independent total duration limit

### Requirement: Skill and MCP extension ports exist without active integrations
The Agent composition layer SHALL depend on explicit Skill registry and MCP registry ports whose V1 implementations return no dynamic skills, servers, or tools. V1 MUST NOT scan skill directories, connect to MCP servers, store MCP credentials, or expose user configuration for either capability.

#### Scenario: V1 Agent starts without skill or MCP configuration
- **GIVEN** the Agent service starts in V1
- **WHEN** it composes its system prompt and tools
- **THEN** only built-in registered tools such as `web_fetch` are available and no external skill or MCP connection is attempted
