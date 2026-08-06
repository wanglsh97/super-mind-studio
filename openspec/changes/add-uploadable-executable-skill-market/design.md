## Context

The completed `add-agent-skill-market` change implements three repository-owned prompt Skills, per-user install/enable state and dynamic Prompt Composer injection. It deliberately rejects user uploads, remote packages and executable code. `add-pi-web-agent` keeps the Agent loop in NestJS, provides replayable tool events and currently forbids filesystem and Shell tools.

This post-V1 change replaces those boundaries with a public traditional Skill package market. All GitHub users may upload ZIP packages to private Alibaba Cloud OSS, the fixed administrator reviews only the first publication, users add up to 50 Skills, and a Run can activate a Skill manually or through model choice. Activated package scripts run in an ephemeral Linux environment supplied by OpenSandbox.

The user explicitly approved breaking the V1 single-ECS deployment rule. Business services remain a NestJS modular monolith, but untrusted execution moves to a dedicated sandbox node. Browser code remains a presentation and direct-OSS-transfer client; it does not host the Linux runtime.

## Goals / Non-Goals

**Goals:**

- Preserve ordinary `SKILL.md` directory packages without requiring a custom executable manifest.
- Deliver upload, first review, discovery, add/remove, manual activation, automatic activation, Shell, Run files and persistent result downloads as one auditable vertical capability.
- Keep PostgreSQL as metadata truth, private OSS as binary truth and OpenSandbox as replaceable execution infrastructure.
- Preserve the existing server-side Pi Agent loop, cursor event replay, user ownership and cancellation semantics.
- Enforce deterministic Thread-sandbox compute/lifetime budgets and independently reset Run-level traffic, Shell and output budgets outside model instructions.

**Non-Goals:**

- No Skill rating, comments, favorites, reports, recommendation ranking or paid marketplace.
- No version history, rollback, post-publication review, update approval or immutable package revision.
- No per-call Shell approval, Skill-specific network allowlist or Secret Vault.
- No user-global Linux workspace, sandbox persistence beyond one Thread, Kubernetes deployment or background job queue.
- No public ZIP download or public script-source viewer.
- No replacement of the existing fixed administrator authentication in this change.

## Decisions

### Decision 1: This is a new change that supersedes the prompt-only Skill runtime

`add-uploadable-executable-skill-market` is independent from V1 and depends conceptually on `add-agent-skill-market` and `add-pi-web-agent`. Existing platform Skills will be migrated into database/OSS records before the TypeScript catalog is removed. Existing installed rows become added rows; the enabled flag stops affecting runtime behavior.

Updating the old change was rejected because executable user packages, private object storage, permanent user files and a dedicated execution plane fundamentally change its intent and threat boundary.

### Decision 2: PostgreSQL stores identity and state; private OSS stores bytes

Suggested entities:

| Entity | Purpose |
| --- | --- |
| `Skill` | UUID, global name, owner, market fields, category, lifecycle state, current object key/hash/size, add count and timestamps |
| `SkillReview` | First-review outcome and reason; administrator actions also enter `AdminAuditLog` |
| `UserAgentSkill` | Unique `userId + skillId` added state; no enabled flag |
| `UserFile` | Owner, Run, input/output direction, file metadata, hash, object key and deletion/cleanup state |
| `AgentRun` additions | sandbox ID, active Skill manifest, file references, sandbox usage and terminal limit reason |

Skill and file objects use a private OSS bucket. NestJS signs narrow upload/download operations and never returns OSS management credentials. PostgreSQL never stores ZIP, package file bodies or user-file bytes. Sanitized `SKILL.md` and file-tree data, when retained for market preview, are bounded derived projections only and MUST NOT be a runtime package dependency; the current OSS object is the only package-byte truth.

### Decision 3: The browser packages a selected folder and uploads directly through scoped OSS credentials

The Skill market upload button opens the File System Access API directory picker directly instead of navigating to a separate upload route or showing an intermediate instruction layer. This avoids the browser's additional `webkitdirectory` upload-confirmation dialog. After selection, a modal shows the parsed editable fields and submission action. The browser removes the selected directory's outer path, requires `SKILL.md` at the resulting package root, creates a ZIP locally and then follows the existing direct-upload protocol. Package bytes still do not pass through NestJS.

For a first upload, NestJS reserves the global name read from the root `SKILL.md`, creates a staging record and signs one staging object. Finalization verifies expected object metadata and package constraints, then opens administrator review. Approval promotes it to `skills/{name}/package.zip`.

For an already published Skill, only its owner may obtain a signed PUT for the existing published object. Successful finalization updates the recorded hash, size and market metadata immediately. This implements the explicitly accepted direct-overwrite behavior.

Abandoned `skill-staging/` objects receive an OSS lifecycle rule. User files use a separate prefix so package overwrite cannot affect user artifacts.

### Decision 4: Traditional Skill metadata seeds the market form

The root `SKILL.md` YAML frontmatter owns the immutable global `name`; the upload modal does not expose a separate global-name field. After folder selection, YAML `name` becomes the default market title and YAML `description` becomes the default market description. The user may edit the market title, description and fixed category without changing the package identity. The package may contain conventional optional directories such as `scripts/`, `references/`, `assets/` and `templates/`. No icon upload or `marketplace.json` is introduced.

Client-side folder preparation and server-side package inspection enforce the accepted limits and produce a safe file-tree projection. Public detail returns sanitized `SKILL.md` and file metadata only. Administrator review may read bounded textual scripts.

### Decision 5: Added Skills are candidates; activation is a runtime transition

The initial model context receives a bounded catalog of at most 50 added published Skill names and descriptions plus the `activate_skill` tool. Manual selection is integrated into the Agent Composer: typing `/` opens a searchable list of added published Skills, and the selected Skills remain visible as removable tags inside the Composer. After every Run binds to a ready Thread sandbox and resets Run state, the API starts a four-lane incremental background prefetch for every currently added published candidate. Prefetch first compares the current candidate hash with the sandbox completion marker, downloads only a missing or changed package, and never blocks sandbox or Run readiness. Candidate failures are isolated and logged without failing the Run. The same Skill has a single in-flight prefetch across Run refreshes.

Installation deliberately uses the accepted simple-overwrite model. It invalidates the completion marker, clears `/workspace/.skills/<name>`, downloads and verifies the ZIP, expands every package file into the fixed directory, and writes a JSON completion marker containing Skill identity and SHA-256 last. No version directory or old-package fallback is retained. A manually selected Skill activates before the first main model invocation. Activation waits for an in-flight prefetch of the same name, then reads a complete local package without querying PostgreSQL or signing an OSS URL. If prefetch failed or the local package is absent/incomplete, activation performs the existing current added/published authorization and one synchronous signed download/install attempt. The complete escaped `SKILL.md` read from the sandbox-cached ZIP is then added to subsequent context. Signed URLs are never persisted or logged.

The completion marker is intentionally treated as a Thread-local cached grant. Removing a Skill from the user's list or administrator delisting it prevents new downloads but does not revoke a package already completed in the current Thread sandbox; it remains activatable until that sandbox is destroyed. This also means a sandbox script can modify the local marker, an explicitly accepted simplicity/security trade-off. Every Run still rebuilds its in-memory active-Skill manifest, so one activation remains idempotent only within that Run.

A Skill activates at most once per Run. There is no separate active-Skill count; context and Run budgets are authoritative. The manifest records the observed package hash because no retained revision is available after overwrite.

### Decision 6: OpenSandbox implements a vendor-neutral execution port

`SandboxRuntimePort` owns create, wait-ready, scoped package download/install, command, file, cancel, per-Run budget reset, metrics and destroy contracts. The first adapter uses the OpenSandbox TypeScript SDK. NestJS and SDK public types do not expose OpenSandbox-specific response objects. Package bytes flow from private OSS to the Thread sandbox and remain ephemeral; NestJS may inspect bytes in deterministic adapters or verification paths but does not persist them in PostgreSQL.

Deployment uses a dedicated Alibaba Cloud ECS execution node:

```text
Business ECS                           Sandbox ECS
Nginx/Web/NestJS ── private API ──> OpenSandbox Server
PostgreSQL/Redis                    Docker + gVisor
        │                                │
        └──────── private OSS ───────────┘
```

OpenSandbox is selected over E2B and Daytona after research: it is Apache-2.0, self-hostable with Docker, exposes command/file APIs and secure runtimes, and fits Alibaba Cloud deployment without a supported-cloud restriction or proprietary control plane.

### Decision 7: Sandbox lifetime is one Agent Thread

The first Agent Run in a Thread creates and waits for exactly one sandbox, including Runs with no selected Skill. Candidate Skill prefetch starts in the background after each Run reset and belongs to the Thread lifecycle: cancelling or finishing one Run stops waiting for it but does not cancel the download. Later Runs in the same Thread reuse that sandbox until its hard lifetime or idle cleanup deadline and run the same incremental cache check, so newly added and updated Skills can be prefetched without freezing the creation-time catalog. Removed or delisted candidates are no longer refreshed, while their already completed local packages remain available in that Thread by the accepted sticky-cache rule. Retained package files and work files remain available to later Runs in that Thread, while Run activation state and Shell/output counters reset at each Run boundary. All active Skills use `/workspace/.skills/<name>`, input files use `/workspace/input`, writable work uses `/workspace/work`, and explicit exports use `/workspace/output`.

`AgentThread` persists sandbox ID, status, creation, last-use and expiry timestamps. `AgentRun.sandboxId` is no longer unique because multiple Runs may audit the same sandbox. Run terminal paths release the Run binding and mark the Thread sandbox idle instead of destroying it. Deleting the Thread destroys the sandbox before removing Thread metadata. A process-local deadline schedules idempotent cleanup; API startup restores future deadlines and reconciles already-expired Thread sandboxes without BullMQ. OpenSandbox's hard TTL remains the final safety boundary.

The existing Agent Run resource and cursor SSE remain authoritative. Browser disconnect does not cancel execution because NestJS talks directly to OpenSandbox. API restart still interrupts in-process Runs under existing semantics, but a non-expired Thread sandbox remains reusable after the service reconnects it.

### Decision 8: Hard budgets apply uniformly

The accepted defaults are one vCPU, 1 GiB memory, 2 GiB disk, 64 processes, a configurable 3,600-second Thread sandbox TTL (`SANDBOX_TIMEOUT_SECONDS`), 60 seconds per command, 20 Shell calls per Run, 100 MiB outbound traffic per Run, 1 MiB per returned output and 5 MiB total returned output per Run. The same timeout also bounds idle retention, and cleanup uses the earlier of the OpenSandbox hard expiry and the idle deadline. One user still has at most one active Agent Run.

Shell and file calls are autonomous with `approvalPolicy=none`. The UI shows ordered tool cards and audit results after calls start; it does not pause for confirmation.

### Decision 9: Public egress is broad but infrastructure targets remain blocked

Skills may connect to arbitrary public internet destinations and install dependencies within the Run budget. The sandbox receives no platform or user secrets. Network policy still blocks loopback, private/link-local/reserved ranges, cloud metadata, business ECS services and the OpenSandbox control plane. Outbound bytes count toward the Run limit.

This is broader than the existing `web_fetch` tool and is an explicitly accepted product choice, not a replacement for its SSRF protections.

### Decision 10: User files are durable OSS objects, not sandbox state

Input uploads and output exports use private OSS objects plus `UserFile` ownership records. Each Run accepts 50 MiB input and 100 MiB output. Each user retains at most 1 GiB across both directions. Files persist until explicit deletion, survive thread deletion and Skill delisting, and are exposed through stable owner-authenticated same-origin routes. The API may proxy the private object or authorize a fresh short-lived signed redirect, but signed OSS URLs are never persisted or projected into chat history.

The sandbox workspace has an explicit delivery boundary: `/workspace/work` is temporary scratch
space, while only regular files under `/workspace/output` may be exported. The model MUST call the
server-owned `export_file` tool for every user-facing artifact before claiming it is available.
Export reads the accepted file through `SandboxRuntimePort`, verifies its size and SHA-256, reserves
quota transactionally, writes it to private OSS and records a stable `UserFile` reference. The event
stream and persisted tool result contain only the file ID and same-origin content/download routes,
never an OSS signed URL. Those authenticated routes MAY proxy the private object or redirect to a
fresh short-lived signed URL after owner authorization.

The platform MUST NOT automatically upload `/workspace`, `/workspace/work`, Skill packages,
dependency caches or other sandbox internals. A file left only in the sandbox is explicitly
temporary and disappears with the Thread sandbox.

Deletion first makes the file unavailable, then attempts OSS removal. Failure records a retryable cleanup state. Quota accounting includes pending-cleanup bytes until deletion is confirmed, preventing users from cycling failed deletes into excess allocation.

### Decision 11: Existing SDK and administrator boundaries remain

All Web business operations use `@supermind/sdk`; direct OSS transfer uses only API-issued narrow credentials. New API groups cover market discovery, owner upload, add/remove, user files, Agent selection and administrator review.

The existing fixed administrator session protects review and delist operations. This remains a development-only authentication boundary and is not made production-safe by this change.

### Decision 12: Failure behavior is explicit

| Failure | Result |
| --- | --- |
| Candidate prefetch fails | keep the sandbox and Run ready, log a bounded warning, and retry that Skill once synchronously if it is later activated |
| OSS package missing/hash mismatch and no completed local package | activation tool fails; no old-directory fallback |
| OpenSandbox unavailable | Run fails or reaches an explicit sandbox-unavailable terminal reason |
| Sandbox command timeout | command is cancelled best effort and returns a bounded limit result |
| Run cancellation | stop current work, export no new files, release the Run binding and retain the Thread sandbox if healthy |
| Thread deletion or idle/hard expiry | destroy the Thread sandbox idempotently and persist destroyed state before metadata removal when possible |
| Output export fails | preserve Run/tool error and do not advertise a downloadable file |
| OSS file deletion fails | hide file, retain cleanup state and count bytes against quota |
| Skill removed or delisted after local installation | new downloads are denied, but the completed package remains activatable in the current Thread until sandbox destruction |

## Risks / Trade-offs

- [Published updates overwrite the only package and skip review] → Record the newly observed SHA-256 for future Runs and retain audit timestamps, while accepting that old code cannot be recovered.
- [Publisher account compromise changes code for every user] → Owner checks and administrator emergency delist remain available; stronger revision review is explicitly out of scope.
- [Autonomous Shell plus public internet can exfiltrate Run files] → No secrets enter the sandbox, private infrastructure remains blocked and fixed resource budgets limit exposure; per-call approval is explicitly out of scope.
- [Fixed administrator credentials protect executable publication] → Keep the current production warning and do not represent the feature as safe for uncontrolled public release.
- [OpenSandbox or gVisor compatibility differs from ordinary Linux] → Pin tested versions and run a package compatibility/limit PoC before production rollout.
- [A dedicated execution node adds cost and operations] → Lazy Thread sandboxes, strict 30-minute TTL, idle cleanup, metrics and leak reconciliation bound usage; publish measured concurrency and monthly ECS cost after PoC.
- [Direct OSS finalization and database state can diverge] → Use explicit upload sessions, idempotent finalization and compensating cleanup rather than a distributed transaction.
- [Prefetching up to 50 candidate packages increases OSS, CPU and sandbox-disk pressure] → Bound concurrent installs, isolate per-Skill failures and keep activation fallback authoritative; the existing sandbox disk limit may leave oversized candidate sets partially prefetched without failing Run startup.
- [Sandbox scripts can modify a trusted local completion marker] → Accept the Thread-local risk for the simple cache design; destroying the Thread sandbox is the revocation boundary, and a future hardening change may move the grant to trusted server state.
- [Administrator delisting does not revoke an already cached Thread package] → Accept execution until the Thread sandbox expires or is destroyed; operators must destroy affected Thread sandboxes when emergency revocation is required.
- [Permanent user files accumulate cost] → Enforce 1 GiB per user, private object accounting and explicit deletion; no automatic retention is promised.

## Migration Plan

1. Complete an OpenSandbox PoC on a dedicated ECS using Docker + gVisor: create, command, file transfer, public egress, blocked infrastructure targets, TTL, cancellation and cleanup.
2. Add private OSS prefixes, scoped-signing adapter, upload sessions, `Skill`/`SkillReview`/`UserFile` schema and migrations behind feature flags.
3. Seed the three platform Skills as published database/OSS packages and migrate `UserAgentSkill` rows from installed/enabled to added state.
4. Release market discovery, owner upload and administrator first-review flows while executable activation remains disabled.
5. Add `SandboxRuntimePort`, the mandatory OpenSandbox adapter and SDK-client test doubles for unit tests; then enable manual Skill activation for internal users.
6. Add `activate_skill`, autonomous Shell/file tools, user inputs/exports, hard budgets, audit events and full Mock/OpenSandbox E2E.
7. Enable public upload only after deployment smoke verifies isolation, OSS ownership, sandbox cleanup and fixed administrator release warning.

Rollback disables upload and sandbox feature flags, refuses new activations, destroys remaining Thread sandboxes within the configured 1,800-second maximum lifetime and restores seeded prompt-only Skills through the compatibility path. Database rows and private OSS objects remain for later recovery; migrations are not destructively rolled back after user content exists.

## Open Questions

- Which Alibaba Cloud region and ECS instance class will host the PoC, and what measured concurrent Run target fits its monthly budget?
- Which exact OpenSandbox, Docker and gVisor versions pass the compatibility suite and will be pinned for the first release?
- What staging-object lifetime and cleanup interval will be configured in OSS?
- Will public rollout remain disabled until the fixed administrator authentication is replaced, or will this accepted development credential be exposed deliberately?
