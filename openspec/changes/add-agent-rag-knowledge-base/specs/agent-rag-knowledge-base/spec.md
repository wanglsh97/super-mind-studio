## ADDED Requirements

### Requirement: Users own isolated knowledge bases
The system SHALL create, list, retrieve, and delete knowledge bases only for the authenticated current user. It MUST NOT accept an owner identifier from the client, and deleting a knowledge base SHALL atomically delete its documents and chunks.

#### Scenario: Another user cannot read a knowledge base
- **GIVEN** a knowledge base owned by user A
- **WHEN** user B requests its detail, document list, or deletion endpoint
- **THEN** the system returns the same not-found boundary used for absent user resources

### Requirement: Text documents are deterministically indexed
The system SHALL accept UTF-8 plain-text and Markdown documents up to the configured size limit, normalize and deterministically chunk their contents, then store embeddings with document and chunk provenance. A document SHALL be READY only after every chunk is embedded and persisted in one transaction; otherwise it SHALL be FAILED with no searchable partial chunks.

#### Scenario: A valid Markdown document becomes searchable
- **GIVEN** an authenticated user and an empty knowledge base
- **WHEN** the user imports a valid Markdown document within the size limit
- **THEN** its document status becomes READY and its ordered chunks retain document title, ordinal, content hash, embedding model, and embedding version

#### Scenario: An embedding failure does not expose partial results
- **GIVEN** a document whose embedding provider fails during indexing
- **WHEN** the import request completes
- **THEN** the document status is FAILED and retrieval returns none of its chunks

### Requirement: Retrieval is scoped, bounded, and version compatible
The system SHALL embed each query through the active embedding version and execute vector similarity retrieval filtered by current user, requested accessible knowledge bases, READY document status, and matching embedding version. It SHALL return at most the configured result limit with document and chunk citations, and SHALL return an empty success result when no match exists.

#### Scenario: Retrieval cannot cross user or version boundaries
- **GIVEN** matching-looking chunks owned by two users or created by different embedding versions
- **WHEN** one user queries a selected knowledge base
- **THEN** only READY chunks owned by that user and matching the active version are eligible for ranking

### Requirement: Development and CI have deterministic embeddings
The system SHALL use an offline deterministic Mock Embedding adapter by default in development and CI. A real embedding adapter SHALL be enabled only when its provider type, endpoint, model, and credential configuration are explicitly valid, and secrets SHALL NOT enter logs or public responses.

#### Scenario: Mock RAG works without a network
- **GIVEN** no external embedding credential and Mock Embedding enabled
- **WHEN** a document is imported and queried in the test environment
- **THEN** indexing and retrieval complete deterministically without outbound network access

### Requirement: Agent retrieval is an untrusted, auditable tool
The Agent tool registry SHALL expose `search_knowledge_base` only in the server runtime. It SHALL validate bounded query, knowledge-base IDs, and result limit; execute retrieval as the current user; and mark all returned document text as untrusted reference data. The system SHALL retain tool-call metadata and citations without logging complete chunk content to Pino.

#### Scenario: An Agent cites retrieved knowledge
- **GIVEN** a user with a READY document and an Agent run that invokes the retrieval tool
- **WHEN** the tool returns matching chunks
- **THEN** the follow-up model turn receives bounded untrusted references with document/chunk citations and the run records the retrieval tool call

#### Scenario: Prompt injection in a document does not expand permissions
- **GIVEN** a retrieved chunk contains instructions to call a different tool or disclose secrets
- **WHEN** it is passed to the Agent
- **THEN** the content remains bounded untrusted data and cannot change the registered tool allowlist or credentials

### Requirement: SDK and Web expose knowledge-base state without leaking content
The SDK SHALL expose typed knowledge-base management contracts. The Web workspace SHALL display the current user's knowledge bases, document indexing state, import failures, and deletion controls; it MUST NOT use raw provider APIs or expose another user's title, document content, chunk text, or retrieval score.

#### Scenario: A user sees an import failure
- **GIVEN** a document fails indexing
- **WHEN** its owner opens the knowledge-base workspace
- **THEN** the UI displays the document as failed with a safe retryable error message and no provider secret or raw stack trace
