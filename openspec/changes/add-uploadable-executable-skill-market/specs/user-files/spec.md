## ADDED Requirements

### Requirement: Agent input files are stored in private OSS and copied into the Thread sandbox

An authenticated user SHALL upload Agent input files through short-lived, user-scoped OSS credentials. NestJS SHALL persist only ownership and file metadata in PostgreSQL. When a Run starts, only files selected by its owner SHALL be made available in that Run's sandbox.

#### Scenario: A user attaches an owned file

- **GIVEN** a user owns a finalized input file
- **WHEN** the user attaches it to a new Agent Run
- **THEN** the file is copied or mounted into the Run workspace and represented by a stable file reference in Agent context

#### Scenario: A user references another user's file

- **GIVEN** a file belongs to another user
- **WHEN** a client attempts to attach or download it
- **THEN** the API responds as if the file does not exist and reveals no metadata

### Requirement: Skill output files are exported before sandbox destruction

The Agent runtime SHALL allow a Skill to mark generated files for export. Before destroying a successful or partially successful sandbox, NestJS SHALL copy accepted output files to private OSS, persist their metadata and expose short-lived signed download URLs through the SDK.

#### Scenario: A Skill generates a result file

- **GIVEN** an active Run creates a file within its output boundary
- **WHEN** the Agent exports it
- **THEN** the file remains downloadable after the sandbox is destroyed

### Requirement: File quotas are authoritative

Each Run SHALL accept at most 50 MiB of input files and export at most 100 MiB of output files. Each user SHALL own at most 1 GiB of retained files across inputs and outputs. The service SHALL check quota before finalizing an upload and before exporting output, and MUST NOT silently delete older files to make space.

#### Scenario: User quota would be exceeded

- **GIVEN** finalizing or exporting a file would exceed the user's 1 GiB quota
- **WHEN** the service checks current retained usage
- **THEN** it rejects the operation with a normalized quota error and preserves existing files

### Requirement: User files persist until explicit deletion

Input and output files SHALL remain in private OSS until their owner explicitly deletes them. Deleting an Agent thread or delisting a Skill MUST NOT delete user files. File deletion SHALL be idempotent and SHALL track a retryable cleanup state when the database update succeeds but OSS deletion fails.

#### Scenario: A thread containing generated files is deleted

- **GIVEN** a thread references exported user files
- **WHEN** the owner permanently deletes the thread
- **THEN** the file records and OSS objects remain available in the owner's file library

#### Scenario: OSS deletion temporarily fails

- **GIVEN** an owner requests file deletion
- **WHEN** the OSS delete call fails transiently
- **THEN** the file becomes unavailable to the user, cleanup remains retryable, and quota accounting does not permit an unsafe double allocation
