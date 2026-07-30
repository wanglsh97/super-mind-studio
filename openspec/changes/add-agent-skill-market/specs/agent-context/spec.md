## MODIFIED Requirements

### Requirement: One layered Prompt Composer is shared by every model

The Agent runtime SHALL use one version-controlled Prompt Composer for every model. It SHALL dynamically compose platform core policy, product execution policy, the current user's installed and enabled platform Skills, user memory context, conversation summary, current conversation messages, and actual registered tools in a fixed trust order before every model invocation. Skill loading SHALL be user-scoped and fail closed to the current reviewed registry. Model-specific renderers MAY change formatting and bounded length but MUST NOT change authorization, safety, or product behavior.

#### Scenario: The same composer reflects a Skill state change

- **GIVEN** an Agent thread whose user changes an installed Skill from enabled to disabled
- **WHEN** the next model invocation is composed
- **THEN** the shared composer excludes that Skill and records the resulting manifest without changing the Tool allowlist

