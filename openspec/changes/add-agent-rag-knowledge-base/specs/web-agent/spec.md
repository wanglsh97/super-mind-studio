## ADDED Requirements

### Requirement: Agent runtime can use owner-scoped knowledge retrieval
The Agent runtime SHALL register the knowledge retrieval tool alongside other server-owned tools when RAG is enabled. It SHALL not require a knowledge base for ordinary Agent runs, and it SHALL preserve the existing run event, cancellation, user isolation, and tool-audit boundaries.

#### Scenario: An Agent run without knowledge bases remains available
- **GIVEN** an authenticated user who has no READY knowledge-base documents
- **WHEN** the user starts an Agent run
- **THEN** the run starts normally and an optional retrieval call produces a bounded empty result rather than failing the run
