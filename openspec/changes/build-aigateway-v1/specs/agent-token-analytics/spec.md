## ADDED Requirements

### Requirement: Token analytics scope is limited to Agent Runs
The platform SHALL collect Token analytics only for model invocations performed as part of an Agent Run. The retired standalone Chat and Prompt optimization capabilities MUST NOT contribute records or aggregates to this capability. Historical records created before this capability is deployed MUST NOT require backfill.

#### Scenario: A completed Agent Run contains multiple model invocations
- **GIVEN** one Agent Run invokes one or more models
- **WHEN** any invocation emits normalized usage or reaches its terminal state
- **THEN** the platform records analytics for that invocation under the Agent Run
- **AND** aggregates include only the recorded invocations after this capability is deployed

### Requirement: Each Agent model invocation preserves token usage dimensions
For every Agent model invocation whose provider supplies usage, the platform SHALL persist its occurrence time, resolved model identity, input Token count, output Token count, total Token count, Prompt Cache Token count, and reasoning Token count. Prompt Cache Token is a subset of input Token, and reasoning Token is a subset of output Token; neither MAY be added again when computing total Token. The platform SHALL preserve whether Prompt Cache and reasoning usage are unavailable rather than treating their absence as a provider-reported zero.

#### Scenario: A provider supplies cache and reasoning usage
- **GIVEN** an Agent model invocation reports input, output, cached-input, and reasoning Token counts
- **WHEN** the invocation is persisted
- **THEN** its analytics record preserves all four dimensions
- **AND** its total Token value remains input Token plus output Token without double-counting cache or reasoning Tokens

#### Scenario: A provider does not expose cache or reasoning usage
- **GIVEN** an Agent model invocation completes successfully but its provider does not report cached-input or reasoning Tokens
- **WHEN** the invocation is persisted
- **THEN** the unavailable dimensions remain distinguishable from a reported value of zero

### Requirement: User analytics show a three-month daily Token calendar
The authenticated user analytics experience SHALL show a GitHub-contribution-style calendar heatmap for the most recent three months. Each cell SHALL represent one local calendar day for the current user, and its intensity SHALL represent the sum of that day's total Tokens across the user's Agent Runs. Month labels and weekday rows SHALL make the calendar chronology legible.

#### Scenario: A user opens token analytics
- **GIVEN** the user has Agent Run Token records within the most recent three months
- **WHEN** the analytics page loads
- **THEN** it renders one heatmap cell per day in that period
- **AND** a day with a higher total Token count has a stronger heatmap intensity than a day with a lower count

### Requirement: User daily details distinguish input, output, cache, and reasoning Tokens
The user analytics experience SHALL provide a daily-detail visualization for the selected analysis period that presents input Token, output Token, Prompt Cache Token, and reasoning Token values. It SHALL communicate that cache and reasoning are component metrics rather than additional consumption. For an individual model that does not provide cache or reasoning usage, the corresponding value SHALL render as `--`. For an aggregate that covers multiple models, known values SHALL be summed and unavailable values SHALL contribute zero.

#### Scenario: A daily aggregate mixes supported and unsupported models
- **GIVEN** a user's daily records include one model with reported Prompt Cache Tokens and one model without that metric
- **WHEN** daily details are calculated
- **THEN** the cache value equals the known reported value
- **AND** the unavailable model contributes zero to that aggregate

#### Scenario: A user inspects one unsupported model
- **GIVEN** all selected records belong to a model that does not report reasoning Token usage
- **WHEN** its daily detail is displayed
- **THEN** the reasoning value is rendered as `--`

### Requirement: User analytics include a model total comparison
The authenticated user analytics experience SHALL provide one comparison chart that shows each model's total Token usage over the selected analysis period. The model comparison MUST use actual resolved model invocations, not only the model initially selected for a Run.

#### Scenario: A Run invokes more than one resolved model
- **GIVEN** an Agent Run has usage records for two resolved models
- **WHEN** the user views the model total comparison
- **THEN** each model's total reflects only its own invocation records

### Requirement: Administrators receive aggregate Token observability without user-content exposure
Authenticated administrators SHALL receive dashboard-ready aggregate charts for Agent Run Token consumption by resolved model, Skill, and Tool, including Prompt Cache Token and Prompt Cache rate where the required input usage is known. These analytics endpoints MUST NOT return complete Prompts, messages, tool arguments, tool results, or any other user content. The initial administrator analytics view SHALL not require interactive business filters.

#### Scenario: An administrator loads Token analytics
- **GIVEN** Agent Run analytics records exist
- **WHEN** an authenticated administrator requests the Token analytics dashboard
- **THEN** the response contains aggregate model, Skill, and Tool metrics and cache-rate data
- **AND** the response contains no complete Prompt or message content

### Requirement: Skill and Tool Token attribution remains non-duplicative and auditable
Each model invocation included in Skill or Tool analytics SHALL retain an auditable attribution link to the Run execution event(s) that caused the attribution. A model invocation's Token count MUST NOT be counted more than once in the total of any one attribution dimension. Skill description text injected into a system prompt MUST NOT be reported as Token consumption of that Skill.

#### Scenario: A Skill is activated during a Run
- **GIVEN** a Skill activation injects that Skill's description into the model context
- **WHEN** the platform calculates the Skill's Token consumption
- **THEN** the injected description Tokens are excluded from the Skill consumption metric
- **AND** model invocation Tokens are not duplicated within the Skill aggregate
