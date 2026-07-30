## ADDED Requirements

### Requirement: Platform Skills are registered from a reviewed manifest

The system SHALL register Skills only from a version-controlled platform manifest. Registration SHALL reject duplicate or malformed IDs, invalid versions, oversized fields, and references to tools that are not present in the server Tool registry. Registration MUST NOT scan local directories, download remote packages, execute Skill code, or read credentials.

#### Scenario: A reviewed Skill is registered

- **GIVEN** a valid platform Skill descriptor whose declared tools are registered
- **WHEN** the API module starts
- **THEN** the Skill appears once in the deterministic market catalog

#### Scenario: An unsafe Skill descriptor is rejected

- **GIVEN** a duplicate, malformed, oversized, or unknown-tool Skill descriptor
- **WHEN** the registry is constructed
- **THEN** startup fails closed before the descriptor can be loaded into an Agent prompt

### Requirement: Authenticated users manage isolated Skill installations

The system SHALL expose an authenticated market catalog and SHALL persist install and enabled state per user. Install and uninstall operations SHALL be idempotent. One user's state MUST NOT change another user's state.

#### Scenario: A user installs and disables a Skill

- **GIVEN** a Skill exists in the platform catalog
- **WHEN** an authenticated user installs it and then disables it
- **THEN** the catalog reports installed true and enabled false only for that user

#### Scenario: A removed Skill has a stale installation row

- **GIVEN** a user installation references a Skill absent from the current platform registry
- **WHEN** the user lists or loads Skills
- **THEN** the stale row is ignored and no unregistered content is returned or injected

### Requirement: Enabled Skills load before every model invocation

The Prompt Composer SHALL load only the current user's installed and enabled platform Skills before every model invocation. It SHALL preserve the fixed trust order, escape Skill content, record exact Skill IDs and versions in the prompt manifest, and SHALL NOT let a Skill expand the registered Tool allowlist.

#### Scenario: An enabled Skill is injected

- **GIVEN** the current user installed and enabled a platform Skill
- **WHEN** the Agent composes the next model request
- **THEN** the Skill instructions appear in `selected_skills` and its ID and version appear in the manifest

#### Scenario: A disabled Skill is excluded

- **GIVEN** the current user disabled an installed Skill
- **WHEN** the Agent composes the next model request
- **THEN** its instructions and version are absent while the actual Tool registry remains unchanged

### Requirement: The Skill market uses the public SDK contract

The `/skills` page SHALL load the authenticated catalog through `@supermind/sdk` and SHALL provide install, enable/disable, and uninstall controls with loading, success, empty, authentication, and error states. The browser MUST NOT receive hidden Skill instructions or mutate arbitrary Skill content.

#### Scenario: A user installs a Skill from the market

- **GIVEN** an authenticated user opens `/skills`
- **WHEN** the user selects install on an available Skill
- **THEN** the page updates from the server response and the Skill is available to the user's next Agent model invocation

