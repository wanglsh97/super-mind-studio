## ADDED Requirements

### Requirement: Untrusted Skill execution uses an external Sandbox runtime port

NestJS SHALL execute Skill Shell and file operations only through a `SandboxRuntimePort`. The only application runtime adapter SHALL use OpenSandbox on a dedicated execution node with Docker and gVisor in both local development and production. The API SHALL NOT provide an in-process sandbox runtime or runtime-selection flag; startup configuration SHALL require the OpenSandbox endpoint and API key. Unit tests MAY replace only the OpenSandbox SDK client behind the real adapter with a deterministic test double. Skill code MUST NOT execute in the NestJS process, business-service containers, database host context or browser.

#### Scenario: OpenSandbox connection settings are missing

- **GIVEN** a local or production API process has no OpenSandbox endpoint or API key
- **WHEN** environment validation runs during startup
- **THEN** startup fails explicitly instead of selecting an in-process fallback

#### Scenario: A Skill requests Shell execution

- **GIVEN** an activated Skill causes the model to call the Shell tool
- **WHEN** the Agent runtime accepts the tool call
- **THEN** NestJS delegates it to the current Thread's OpenSandbox instance under the current Run budget and returns the bounded result to the Agent loop

### Requirement: One ephemeral Linux sandbox is shared within an Agent Thread

The first Agent Run in a Thread SHALL create and wait for exactly one sandbox. Later Runs in that Thread SHALL reuse the same temporary workspace while it remains healthy and unexpired. A Run terminal state SHALL release its Run binding without destroying the sandbox. The sandbox SHALL be destroyed when the Thread is deleted, when its configured idle/hard deadline expires, or when the sandbox becomes unusable; cleanup SHALL be idempotent and terminate background processes.

#### Scenario: A Run starts without a selected Skill

- **GIVEN** a valid Agent Run has no manually selected Skill
- **WHEN** execution starts
- **THEN** the platform creates one ready Thread-owned sandbox before the first model invocation

#### Scenario: Two Skills run in one Agent Run

- **GIVEN** a Run activates two added Skills
- **WHEN** both use files or Shell
- **THEN** they use the same Thread-owned sandbox and the platform creates no second sandbox for that Run

#### Scenario: A later Run reuses the Thread workspace

- **GIVEN** a Thread has a healthy unexpired sandbox from an earlier completed Run
- **WHEN** the user starts another Run in that Thread
- **THEN** the platform reuses the same sandbox ID, resets Run-level counters, incrementally prefetches current candidates and retains completed Thread-local Skill packages

#### Scenario: A Run is cancelled

- **GIVEN** a Shell command is active
- **WHEN** the Run owner cancels the Run
- **THEN** cancellation propagates best effort to the command, no later command starts, and the healthy Thread sandbox remains available for a later Run

#### Scenario: A Thread is deleted

- **GIVEN** a Thread has no active Run and owns a sandbox
- **WHEN** its owner deletes the Thread
- **THEN** sandbox destruction is attempted idempotently before the Thread metadata is removed

### Requirement: Active Skill packages download from private OSS into the Thread sandbox

Before the first model invocation of every Run, the platform SHALL authorize and install every manually selected active Skill into the Thread sandbox. Later model activations SHALL use the same installation flow. Retained package files from an earlier Run MUST NOT imply current activation or authorization. NestJS SHALL issue only a short-lived read-only URL scoped to the current private OSS object; the sandbox SHALL download the package, verify expected byte size and SHA-256, and extract it under `/workspace/.skills/<name>`. Package files SHALL remain ephemeral and MUST NOT be persisted to PostgreSQL. Signed URLs MUST NOT enter Agent events, database records or application logs.

#### Scenario: A selected package is installed before inference

- **GIVEN** a Run has two manually selected published Skills
- **WHEN** its sandbox becomes ready
- **THEN** both current OSS packages are integrity-checked and installed in the same sandbox before the first model request

#### Scenario: A downloaded package fails integrity verification

- **GIVEN** OSS returns bytes whose size or SHA-256 differs from the published metadata
- **WHEN** the sandbox installs the Skill
- **THEN** activation fails with a normalized integrity error, the package is not made active, and no database content projection is used as fallback

### Requirement: Sandbox resource budgets are enforced outside the model

The platform SHALL enforce per-sandbox limits of one vCPU, 1 GiB memory, 2 GiB temporary disk, 64 processes and a configurable total lifetime defaulting to 3,600 seconds through `SANDBOX_TIMEOUT_SECONDS`. The same value SHALL bound idle retention. Each Shell command SHALL be limited to 60 seconds; each Run SHALL independently permit at most 20 Shell calls, 100 MiB outbound traffic, 1 MiB returned by one call and 5 MiB total returned tool output. Skill instructions MUST NOT raise these limits.

#### Scenario: Shell call budget is exhausted

- **GIVEN** a Run has completed 20 Shell calls
- **WHEN** the model requests another Shell call
- **THEN** the platform refuses execution and returns a normalized limit result without contacting the sandbox

#### Scenario: Sandbox TTL expires

- **GIVEN** a Thread sandbox reaches its configured 3,600-second lifetime
- **WHEN** work is still active
- **THEN** OpenSandbox terminates it and any active Agent Run ends with an explicit sandbox limit reason

### Requirement: Sandboxes may reach arbitrary public internet without receiving secrets

The sandbox SHALL permit outbound connections to arbitrary public internet destinations without a Skill-specific domain allowlist. It MUST still deny loopback, private, link-local, reserved, cloud metadata, business data services and the OpenSandbox control plane. The platform MUST NOT inject database, Redis, provider, OSS management or user secrets into the sandbox.

#### Scenario: A script connects to a public endpoint

- **GIVEN** an activated Skill executes a command that connects to a public address
- **WHEN** the connection is within Run resource budgets
- **THEN** the sandbox allows it without requesting per-call user approval

#### Scenario: A script targets a private service

- **GIVEN** a command attempts to reach a protected private or metadata address
- **WHEN** the sandbox network policy evaluates the destination
- **THEN** the connection is blocked outside the model regardless of Skill instructions

### Requirement: Sandbox execution is observable and replayable

The Agent event stream SHALL expose sandbox creation, readiness, command start, bounded stdout/stderr, file operations, limits, cleanup and terminal state in sequence. `AgentRun` and `AgentToolCall` SHALL record sandbox ID, Skill name, observed package SHA-256, command, exit status, duration, bounded output metadata and normalized error without storing secrets.

#### Scenario: A user reconnects after a command completes

- **GIVEN** a command completed while the event connection was unavailable
- **WHEN** the owner reconnects with the last sequence
- **THEN** persisted sandbox and command events restore the same tool state without re-executing the command
