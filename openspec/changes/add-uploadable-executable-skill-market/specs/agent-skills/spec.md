## ADDED Requirements

### Requirement: Published Skill packages are the runtime catalog

The Skill registry SHALL resolve new downloads only from `published` database metadata records and their current private OSS objects. PostgreSQL SHALL store bounded identity, lifecycle, object key, size and hash metadata, but MUST NOT store ZIP or package file bodies or act as the runtime content source. A completed package previously downloaded into the same Thread sandbox MAY activate directly from its local completion marker and verified cached ZIP without a new database or OSS request. User removal or administrator delisting SHALL prevent a new download but SHALL NOT revoke that completed Thread-local package before sandbox destruction. The runtime MUST NOT fall back to a database content projection or an incomplete local installation.

#### Scenario: A published package cannot be loaded

- **GIVEN** a user's added Skill is published, its current OSS object is unavailable and the Thread sandbox has no completed local package
- **WHEN** the Agent attempts to activate it
- **THEN** activation fails with a normalized tool result and no local or prior package is executed

#### Scenario: A current prefetched package remains usable

- **GIVEN** prefetch completed a Skill package and its cached ZIP still matches the Thread-local completion marker
- **WHEN** OSS is temporarily unavailable and the Agent activates that Skill
- **THEN** activation reads the completed local package without querying PostgreSQL or requesting another signed download

#### Scenario: Removal does not revoke a Thread-local package

- **GIVEN** a Skill package completed installation in a Thread sandbox
- **WHEN** the user removes it or an administrator delists it before that sandbox is destroyed
- **THEN** the current Thread may still activate the local package, while another Thread cannot newly download it

### Requirement: Added Skills can be selected manually or by the model

After every Run binds to a ready Thread sandbox, the runtime SHALL asynchronously perform an incremental prefetch of every currently added published candidate Skill with at most four concurrent package operations. Prefetch MUST NOT block sandbox or Run readiness, and one failed candidate MUST NOT cancel other candidates or fail the Run. It SHALL skip a package whose candidate SHA-256 already matches its complete local marker. A user MAY explicitly select any published Skill they have added, causing it to activate before the first model invocation. The Agent Composer SHALL open a searchable Skill list when the user types `/`, and SHALL show each selected Skill as a removable selection inside the Composer instead of using a separate Run Skills panel. Otherwise the model SHALL receive the names and descriptions of the user's added published Skills and MAY call `activate_skill`.

Activation SHALL await an in-flight prefetch of the same Skill and then load the complete `SKILL.md` from the cached ZIP when a valid local completion marker exists. It SHALL NOT perform a new authorization or OSS request on that local hit. When no completed package exists or background prefetch failed, activation SHALL authorize the current added/published state, issue a fresh short-lived read-only URL scoped to the current object and synchronously retry download, size/SHA-256 verification and simple-overwrite installation once. Installation SHALL invalidate the marker and clear the old fixed directory before writing files, then write the identity/SHA-256 completion marker last. Signed URLs MUST NOT be persisted or logged.

#### Scenario: Candidate prefetch does not block Run startup

- **GIVEN** a user has multiple added published Skills and one package download is slow or fails
- **WHEN** the Thread sandbox becomes ready
- **THEN** the Run becomes ready without waiting for all candidate downloads while bounded background prefetch continues and isolates that failure

#### Scenario: Activation retries a failed prefetch

- **GIVEN** background prefetch failed for an otherwise authorized current Skill
- **WHEN** the user or model later activates that Skill
- **THEN** activation issues a fresh scoped download and retries installation once before returning success or a normalized failure

#### Scenario: A user manually selects a Skill

- **GIVEN** the user has added a published Skill
- **WHEN** the user types `/` in the Agent Composer, selects that Skill and creates a Run
- **THEN** the Run activates it without first requiring an `activate_skill` model call

#### Scenario: A user filters and removes a manual Skill selection

- **GIVEN** the user has more than one added published Skill
- **WHEN** the user types `/` plus part of a Skill name or description
- **THEN** the Composer shows only matching Skills and lets the user select or remove them without leaving the Composer

#### Scenario: The model chooses a Skill

- **GIVEN** the candidate directory contains an appropriate added Skill
- **WHEN** the model calls `activate_skill` with its name
- **THEN** the runtime reads a completed Thread-local package directly, or validates ownership and publication only when a download is required

### Requirement: Skill activation is bounded by Run budgets rather than a separate count

A Run SHALL NOT impose a separate maximum number of activated Skills. Each Skill MUST activate at most once in a Run, and all activated Skills SHALL share the same context, Shell, output and sandbox budgets. When mandatory `SKILL.md` content cannot fit the model context, the Run SHALL return an explicit context-limit error rather than silently truncating the instructions.

#### Scenario: The same Skill is activated twice

- **GIVEN** a Skill is already active in a Run
- **WHEN** the model requests it again
- **THEN** the operation is idempotent and consumes no second package load or activation entry

## MODIFIED Requirements

### Requirement: Authenticated users manage isolated Skill installations

The system SHALL persist an idempotent added/not-added state per user and published Skill. It SHALL NOT maintain a separate enabled flag. One user MUST NOT affect another user's state, and each user SHALL add at most 50 Skills. Delisted or missing Skills SHALL remain visible as unavailable in the user's own list and MUST NOT download into another Thread, while a completed package already present in the current Thread MAY still activate until sandbox destruction.

#### Scenario: A user adds and removes a Skill

- **GIVEN** a published Skill exists and the user is below the 50-Skill limit
- **WHEN** the user adds it twice and later removes it twice
- **THEN** both operations are idempotent and affect only that user

#### Scenario: The add limit is reached

- **GIVEN** a user already has 50 added Skills
- **WHEN** the user attempts to add another
- **THEN** the API rejects the operation until an existing Skill is removed

### Requirement: The Skill market uses the public SDK contract

The `/skills` experience SHALL use `@supermind/sdk` for public discovery, authenticated add/remove state, upload finalization and owner management. It SHALL provide loading, empty, authentication, upload, pending-review, rejected, delisted and error states. The SDK MUST NOT expose OSS management credentials or permit a non-owner to mutate Skill content.

#### Scenario: A user adds a Skill from the market

- **GIVEN** an authenticated user views a published Skill
- **WHEN** the user selects add
- **THEN** the page updates from the idempotent server response and the Skill appears in the next Agent Run's candidate directory

## REMOVED Requirements

### Requirement: Platform Skills are registered from a reviewed manifest

**Reason**: User-uploaded PostgreSQL and OSS packages replace the version-controlled platform manifest as the Skill content source.

**Migration**: Seed existing platform Skills as owned published records and upload their traditional packages before removing the TypeScript catalog.

### Requirement: Enabled Skills load before every model invocation

**Reason**: Added Skills are candidates, not automatically injected instructions; full instructions load only after manual selection or `activate_skill`.

**Migration**: Convert existing installed rows to added rows, ignore the prior enabled flag, and use candidate-directory activation on subsequent Runs.
