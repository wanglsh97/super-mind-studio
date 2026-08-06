## ADDED Requirements

### Requirement: Website creation is an existing Agent run mode
The system SHALL allow only an authenticated GitHub user to send `mode: website` through the existing Agent thread run API. It MUST reuse the same Thread, Run, SSE, context, Sandbox and cancellation lifecycle as normal Chat and MUST NOT expose a separate website creation API.

#### Scenario: GitHub user starts website mode
- **GIVEN** a user has an authenticated GitHub session
- **WHEN** the frontend sends an Agent run with `mode: website`
- **THEN** the server admits the normal Agent run and applies the built-in static website Skill and website-only tool profile

#### Scenario: Unsupported identity starts website mode
- **GIVEN** the current identity is anonymous, Google or unauthenticated
- **WHEN** it submits `mode: website`
- **THEN** the server rejects the run before creating a project or Sandbox and the Web presents a GitHub login action

### Requirement: Website mode automatically loads one immutable static-site Skill
Every website-mode run SHALL automatically load the platform-owned `website-building` Skill before the first model call. The Skill SHALL live in the repository as a standard root `SKILL.md` plus required `scripts` resources, and the API SHALL validate and cache it at startup instead of hard-coding its contents in TypeScript. The platform SHALL install it under `/workspace/.skills/website-building`, using the same `/workspace/.skills/<name>` root as every other Sandbox Skill. The Skill SHALL require React, TypeScript, Vite, Tailwind CSS, shadcn/ui, Lucide, pnpm, `/workspace/work` and a `pnpm build -- --base=./` output at `/workspace/work/dist` so the static artifact uses relative asset paths. It SHALL prohibit databases, server runtimes, authentication backends, payments, private environment variables and private API keys.

#### Scenario: Agent builds a website
- **GIVEN** a website-mode run has started
- **WHEN** the model receives its system context
- **THEN** the immutable Skill content and fixed stack workflow are active without model discovery or user-managed Skill activation

#### Scenario: Built-in Skill package is invalid at startup
- **GIVEN** `website-building/SKILL.md` or one of its required scripts is missing, malformed or renamed
- **WHEN** the API initializes its built-in Skill registry
- **THEN** startup fails before serving Agent runs instead of silently using partial or stale instructions

### Requirement: One Thread retains one current website delivery
A Thread SHALL have at most one current WebProject delivery. Each successful `create_website` call SHALL replace the current source/build assets and reset their expiry to thirty days after that success. The system SHALL NOT expose versions, rollback or old downloads.

#### Scenario: User modifies a delivered website
- **GIVEN** the same Thread already has a successful website delivery
- **WHEN** a later website-mode run successfully calls `create_website`
- **THEN** the new artifacts become current, the prior artifacts become unavailable and prior tool cards are marked superseded

#### Scenario: Modification build fails
- **GIVEN** a previous successful delivery exists
- **WHEN** the modified project fails delivery validation
- **THEN** the failed attempt does not replace the current artifacts and the Agent continues fixing the Sandbox project

### Requirement: Preview exists only with the originating Thread Sandbox
The current delivery SHALL have an owner-scoped same-origin preview only while the originating Thread Sandbox exists. Switching threads or refreshing SHALL NOT destroy the Sandbox. Deleting the Thread SHALL destroy it and invalidate preview while the final ZIP assets remain downloadable until expiry.

#### Scenario: Owner opens current preview
- **GIVEN** the owner requests the current project preview and the Thread Sandbox is alive
- **WHEN** the API validates owner, run, current project and port
- **THEN** it obtains a short-lived Sandbox endpoint without persisting its credential and serves it through the isolated platform preview capability

#### Scenario: Thread is deleted
- **GIVEN** a website has been delivered
- **WHEN** its owner deletes the originating Thread
- **THEN** the Sandbox and preview become unavailable while source and dist downloads remain owner-accessible until their expiry
