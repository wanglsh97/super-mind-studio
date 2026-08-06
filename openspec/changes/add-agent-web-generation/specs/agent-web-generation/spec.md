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
Every website-mode run SHALL automatically load the platform-owned `website-building` Skill before the first model call. The Skill SHALL live in the repository as a standard root `SKILL.md` plus required `scripts` resources, and the API SHALL validate and cache it at startup instead of hard-coding its contents in TypeScript. The platform SHALL install it under `/workspace/.skills/website-building`, using the same `/workspace/.skills/<name>` root as every other Sandbox Skill. The Skill SHALL require React, TypeScript, Vite, Tailwind CSS, shadcn/ui, Lucide, pnpm, `/workspace/work`, a meaningful kebab-case `package.json.name`, and a `pnpm build -- --base=./` output at `/workspace/work/dist` so the static artifact uses relative asset paths. It SHALL prohibit databases, server runtimes, authentication backends, payments, private environment variables and private API keys.

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

### Requirement: Current website delivery opens in an in-thread Artifact workspace
The Web SHALL render a successful current `create_website` result as a compact delivery card in the conversation and SHALL open an adjacent Website Artifact workspace from that card. On wide screens, the Artifact workspace and the Agent chat panel SHALL be peer columns under the page shell, forming a sidebar/chat/artifact three-column composition rather than nesting the Artifact inside the chat panel. The page shell SHALL NOT inset the Artifact column or its divider; responsive page padding SHALL belong only to the chat panel. The workspace SHALL provide isolated temporary webpage preview, bounded read-only source ZIP browsing, and one owner-scoped source ZIP download without introducing a separate website API. The only download control SHALL be labeled “下载”, target the source archive named `<package-name>.zip`, and MUST NOT render a redundant build ZIP download beside it.

#### Scenario: Current delivery is completed
- **GIVEN** `create_website` has successfully made a delivery current
- **WHEN** its Tool UI is rendered or the user activates its delivery card
- **THEN** the conversation shows only the compact card and the Artifact workspace can display preview, source files and current downloads from the Tool result metadata as a peer column beside the chat on wide screens

#### Scenario: Source is browsed
- **GIVEN** the current delivery exposes an owner-scoped source archive named from `package.json.name`
- **WHEN** the user selects the code tab
- **THEN** the browser fetches and parses the archive within configured compressed-size, entry-count, per-file and total-expanded-size limits, displays text files read-only and never executes archive contents

#### Scenario: Delivery has been superseded
- **GIVEN** a later successful delivery has replaced the Tool result's project run
- **WHEN** the older delivery card is rendered
- **THEN** it is marked as superseded and cannot open an old preview, source archive or download

### Requirement: Deployment control is presentational only
The Website Artifact workspace SHALL show a disabled deployment control as a future-entry affordance. It MUST NOT register a click action, send a network request, mutate local state beyond native focus behavior or claim that the website has been deployed.

#### Scenario: User sees deployment control
- **GIVEN** the current website Artifact workspace is open
- **WHEN** the header actions are rendered
- **THEN** the deployment control is visibly disabled and communicates that deployment is not yet available
