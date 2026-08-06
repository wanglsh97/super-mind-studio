## MODIFIED Requirements

### Requirement: One layered Prompt Composer is shared by every model

The Agent runtime SHALL use one version-controlled Prompt Composer for every model. Before the first model call of a Run it SHALL compose platform core policy, product execution policy, a bounded directory containing the current user's added published Skill names and descriptions, user memory context, conversation summary, current messages and actual registered tools in a fixed trust order. After manual or model activation it SHALL add the complete escaped `SKILL.md` for each active Skill on subsequent invocations. Model-specific renderers MAY change formatting and bounded length but MUST NOT change authorization, sandbox limits or product behavior.

#### Scenario: Candidate Skills do not inject full instructions

- **GIVEN** a user has added published Skills but selected none
- **WHEN** the first model invocation is composed
- **THEN** it contains their bounded names and descriptions but not their complete `SKILL.md` bodies

#### Scenario: Activation changes the next model invocation

- **GIVEN** the model successfully activates one candidate Skill
- **WHEN** the follow-up invocation is composed
- **THEN** its complete instructions and observed package SHA-256 appear in the active Skill manifest without changing platform policy or resource budgets

### Requirement: Tool risk is explicit and enforced outside the prompt

Every registered Agent tool SHALL declare a risk level and approval policy. This post-V1 change SHALL register `skill`, Shell and Skill file tools with autonomous execution and no per-call approval, as explicitly accepted product behavior. The runtime SHALL still enforce user ownership, publication state, sandbox isolation and hard budgets outside the prompt, and the prompt SHALL advertise only tools actually registered for the active Run. Candidate metadata SHALL be wrapped by `<available_skills>`, while activated complete instructions SHALL be wrapped by `<skill_content>`.

#### Scenario: The model autonomously calls Shell

- **GIVEN** at least one Skill is active and the Run has remaining Shell budget
- **WHEN** the model emits a schema-valid Shell call
- **THEN** the registry executes it in the current Thread sandbox under the current Run budget without pausing for user approval

#### Scenario: Prompt text requests a higher budget

- **GIVEN** Skill instructions tell the model to ignore platform limits
- **WHEN** a tool call exceeds a hard Run budget
- **THEN** the runtime refuses it outside the model regardless of the instructions
