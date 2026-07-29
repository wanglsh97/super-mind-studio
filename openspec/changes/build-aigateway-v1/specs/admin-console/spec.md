## ADDED Requirements

### Requirement: Management routes require a valid administrator session
The V1 API SHALL authenticate the fixed development credential `root` / `123456`, create a short-lived signed session in an HttpOnly cookie, and reject unauthenticated access to `/api/v1/admin/*` except login. The Web application SHALL redirect unauthenticated `/admin/*` visits to `/admin/login`.

#### Scenario: Administrator logs in successfully
- **GIVEN** no administrator session exists
- **WHEN** `root` submits password `123456` within the login rate limit
- **THEN** the API sets a signed HttpOnly session cookie
- **AND** the administrator can open the dashboard

#### Scenario: Anonymous visitor requests admin data
- **GIVEN** no valid session cookie exists
- **WHEN** the visitor calls an admin dashboard, log, table, or audit endpoint
- **THEN** the API returns 401 without returning any management data

### Requirement: Administrator login is separately rate limited
The login endpoint SHALL enforce a configurable default limit of 5 failed or attempted logins per source IP per minute and SHALL return the same generic authentication error for an unknown username and an incorrect password.

#### Scenario: Login limit is exceeded
- **GIVEN** an IP has reached the administrator login limit
- **WHEN** another login is attempted within the window
- **THEN** the API returns 429 and does not create a session

### Requirement: Dashboard presents aggregate operational status
The dashboard SHALL show today's request count, success rate, estimated CNY cost, model health, 24-hour request trend, per-model latency statistics, and recent errors without exposing complete Prompts.

#### Scenario: Administrator opens dashboard
- **GIVEN** a valid administrator session and persisted request data
- **WHEN** dashboard overview and chart endpoints are loaded
- **THEN** aggregates are returned in dashboard-ready form
- **AND** no complete Prompt field appears in the responses

### Requirement: Request logs are searchable and details are complete
The administrator SHALL be able to paginate and filter request logs by time, capability, model, status, and request ID. Only the authenticated detail endpoint SHALL return the complete Prompt/messages, provider metadata, failover path, usage, estimated cost, and full normalized error.

#### Scenario: Administrator opens one request detail
- **GIVEN** a valid session and an existing request ID
- **WHEN** the detail endpoint is requested
- **THEN** it returns the complete diagnostic record including the stored Prompt

#### Scenario: Administrator opens an Agent model-call detail
- **GIVEN** an Agent model-call RequestLog is associated with a persisted AgentRun
- **WHEN** the authenticated administrator opens its detail
- **THEN** the response returns the exact Provider request Prompt/messages snapshot
- **AND** returns all persisted messages of the associated AgentRun in sequence order, including assistant reasoning/text and tool results
- **AND** the Web UI labels the Provider input snapshot separately from the complete Agent Run messages

### Requirement: Database management is constrained by a server allowlist
The admin table API SHALL expose only approved business tables, rows, operations, and editable fields. It MUST NOT accept arbitrary table names, SQL fragments, secret/config tables, or edits to immutable identity and audit fields.

#### Scenario: Client submits a non-allowlisted field
- **GIVEN** a valid administrator session
- **WHEN** a PATCH request contains a field not marked editable by the server capability definition
- **THEN** the API rejects the complete update and changes no row

### Requirement: Destructive changes are confirmed and audited atomically
The Web application SHALL require explicit confirmation before edit or delete. The API SHALL perform an allowed business mutation and its `AdminAuditLog` insert in one database transaction, recording administrator identity, action, target, before/after snapshot as applicable, request ID, source IP, and timestamp.

#### Scenario: Administrator deletes a request log
- **GIVEN** deletion is allowed and confirmed
- **WHEN** the API deletes a RequestLog
- **THEN** its related BillingRecord is handled in the same transaction according to the relation policy
- **AND** one immutable audit log records the operation

### Requirement: Audit logs are read-only
The administrator MAY query and filter `AdminAuditLog`, but no public or admin endpoint SHALL edit or delete audit records.

#### Scenario: Client attempts to mutate audit log data
- **GIVEN** a valid administrator session
- **WHEN** it requests an edit or deletion of an audit record
- **THEN** the API rejects the operation and the audit record remains unchanged
