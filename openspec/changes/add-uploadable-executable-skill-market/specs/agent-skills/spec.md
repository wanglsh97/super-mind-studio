## ADDED Requirements

### Requirement: Published Skill packages are the runtime catalog

The Skill registry SHALL resolve only `published` database records and their current private OSS objects. It SHALL validate ownership state, package availability and observed SHA-256 before activation. It MUST NOT fall back to an unregistered local directory or stale package when the current object cannot be loaded.

#### Scenario: A published package cannot be loaded

- **GIVEN** a user's added Skill is published but its current OSS object is unavailable
- **WHEN** the Agent attempts to activate it
- **THEN** activation fails with a normalized tool result and no local or prior package is executed

### Requirement: Added Skills can be selected manually or by the model

At Run creation, a user MAY explicitly select any published Skill they have added, causing it to activate before the first model invocation. Otherwise the model SHALL receive the names and descriptions of the user's added published Skills and MAY call `activate_skill`. Activation SHALL load the complete `SKILL.md`, mount the current package into the Run sandbox and make Shell/file tools available for subsequent turns.

#### Scenario: A user manually selects a Skill

- **GIVEN** the user has added a published Skill
- **WHEN** a Run is created with that Skill selected
- **THEN** the Run activates it without first requiring an `activate_skill` model call

#### Scenario: The model chooses a Skill

- **GIVEN** the candidate directory contains an appropriate added Skill
- **WHEN** the model calls `activate_skill` with its name
- **THEN** the runtime validates ownership and publication before loading its instructions and package

### Requirement: Skill activation is bounded by Run budgets rather than a separate count

A Run SHALL NOT impose a separate maximum number of activated Skills. Each Skill MUST activate at most once in a Run, and all activated Skills SHALL share the same context, Shell, output and sandbox budgets. When mandatory `SKILL.md` content cannot fit the model context, the Run SHALL return an explicit context-limit error rather than silently truncating the instructions.

#### Scenario: The same Skill is activated twice

- **GIVEN** a Skill is already active in a Run
- **WHEN** the model requests it again
- **THEN** the operation is idempotent and consumes no second package load or activation entry

## MODIFIED Requirements

### Requirement: Authenticated users manage isolated Skill installations

The system SHALL persist an idempotent added/not-added state per user and published Skill. It SHALL NOT maintain a separate enabled flag. One user MUST NOT affect another user's state, and each user SHALL add at most 50 Skills. Delisted or missing Skills SHALL remain visible as unavailable in the user's own list but MUST NOT activate.

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

