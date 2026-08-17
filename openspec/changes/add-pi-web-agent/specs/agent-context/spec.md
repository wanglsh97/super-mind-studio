## ADDED Requirements

### Requirement: Agent system prompt is composed from versioned trust layers
The Agent runtime SHALL use one version-controlled Prompt Composer for every model. It SHALL dynamically compose platform core policy, product execution policy, runtime context, actual registered tools, selected platform skills, user memory context, conversation summary, and current conversation messages in a fixed trust order. Model-specific renderers MAY change formatting and bounded length but MUST NOT change authorization, safety, or product behavior.

All platform-authored model-facing prompt templates SHALL be written in English, including the main Agent system prompt, forced-summary prompt, built-in tool descriptions and schemas, and tool-result trust wrappers. Dynamic user, Skill, Memory, MCP, and external content SHALL retain its original language and trust classification. The response contract SHALL still instruct the model to answer in the user's current language unless requested otherwise.

#### Scenario: English templates preserve multilingual user content
- **GIVEN** the platform prompt templates are English and a user message or dynamic context entry is written in another language
- **WHEN** the Agent context package is composed
- **THEN** all platform-authored instructions remain English, the dynamic content retains its original language, and the model is instructed to respond in the user's current language

#### Scenario: Empty future integrations do not create fictional capabilities
- **GIVEN** the V1 Skill, MCP, and Memory ports return empty collections
- **WHEN** an Agent run is composed
- **THEN** the prompt and tool list contain only actual built-in capabilities and no filesystem scan, MCP connection, credential read, or Memory extraction occurs

#### Scenario: Prompt assembly is auditable
- **GIVEN** an Agent run is created
- **WHEN** its context package is composed
- **THEN** the run records the prompt profile version/hash, component versions, tool names, selected skill versions, memory IDs, summary ID, and context budget without duplicating the complete rendered prompt

### Requirement: Agent output adapts efficiency and style to the task
The Agent system prompt SHALL define separate `output_efficiency` and `output_style` components. Output efficiency SHALL optimize for useful information rather than minimum length: direct questions receive direct answers, while long-running work reports only material discoveries, meaningful phase changes, blockers, and significant decisions instead of narrating routine tool calls. Concision MUST NOT remove required evidence, material caveats, uncertainty, failures, or verification results.

Output style SHALL present the Agent as a professional, senior creative collaborator. For complex creative work it SHALL briefly explain relevant judgments and tradeoffs and MAY suggest high-value next directions. When a missing choice would materially determine the creative direction, the Agent SHALL ask the user rather than decide on their behalf. When the user has already supplied sufficient direction, it SHALL proceed without restating the brief or adding a separate plan-approval ritual. The Agent MAY explain risks and recommend an alternative, but after the user confirms a valid direction it SHALL follow that direction. Responses SHALL use only as much structure as clarity requires, SHALL NOT impose a fixed final-answer template, and SHALL avoid generic praise, filler, and routine follow-up offers.

#### Scenario: Straightforward question stays direct
- **GIVEN** the user asks a stable explanatory question that does not require tools or a creative decision
- **WHEN** the Agent answers
- **THEN** it explains the answer clearly and concisely without inventing milestones, design commentary, or an optional follow-up question

#### Scenario: Complex creative work communicates selectively
- **GIVEN** the Agent is completing a multi-stage website, document, image, or video task
- **WHEN** work progresses and the final result is delivered
- **THEN** it reports only material discoveries, phase changes, blockers, and significant decisions, briefly explains relevant creative judgments, and does not narrate every tool call or force the result into a fixed response structure

#### Scenario: Missing creative direction is not silently invented
- **GIVEN** a missing user choice would materially change the audience, style, goal, or deliverable
- **WHEN** the Agent cannot infer that choice without deciding for the user
- **THEN** it asks a concise question before proceeding, but does not require another approval after the user has supplied sufficient direction

### Requirement: Model context windows are declared by the server catalog
Every Agent-capable model SHALL declare a positive `contextWindowTokens` in the version-controlled model catalog. Before every model invocation the runtime SHALL calculate a usable input budget after reserving configured output tokens, serialized tool-schema tokens, and a safety reserve of five percent of the model window or 1,024 tokens, whichever is greater.

#### Scenario: Provider metadata is unavailable
- **GIVEN** a model has no runtime metadata endpoint or provider tokenizer
- **WHEN** an Agent call is prepared
- **THEN** the server uses its catalog context window and a conservative estimator, marks the budget estimated, and compresses early rather than querying the provider dynamically

### Requirement: Durable conversation history is supplied to every model invocation
Before each initial or tool-follow-up model invocation, the runtime SHALL combine the latest valid structured summary, persisted thread messages not covered by that summary, the active Pi loop context, and the current user input without duplicating messages. It SHALL preserve the current user input and incomplete tool calls/results and SHALL normally keep the latest four complete turns, with a hard minimum of two when budget permits.

#### Scenario: A later run depends on an earlier turn
- **GIVEN** a user completed one run and submits a follow-up in the same thread
- **WHEN** the next model invocation is prepared
- **THEN** the model receives the relevant persisted messages or their validated summary before the new user message

### Requirement: Historical reasoning remains distinct and low trust
Provider-returned historical reasoning MAY be supplied to later calls using a provider-native reasoning part when supported or a delimited `historical_reasoning` fallback otherwise. The system prompt SHALL state that historical reasoning is an unverified work record and MUST NOT be treated as a fact, user instruction, or authorization. Reasoning SHALL remain separately bounded, escaped, and omitted from forced summaries.

#### Scenario: Moderate compression removes old reasoning
- **GIVEN** persisted turns contain provider reasoning
- **WHEN** moderate compression is selected
- **THEN** completed-turn reasoning is excluded while user text, final assistant text, and required tool state remain ordered

### Requirement: Context compression is progressive
The runtime SHALL select `none` below 60 percent, `light` from 60 percent, `moderate` from 75 percent, and `forced` from 88 percent of usable input budget or whenever the next invocation is predicted not to fit. Light compression SHALL remove older reasoning and redundant tool progress and replace media with references. Moderate compression SHALL additionally summarize completed tool results and redundant failed attempts. Forced compression SHALL use the current thread model to produce the structured summary.

#### Scenario: A large tool result triggers compression before follow-up
- **GIVEN** a bounded tool result makes the next model input cross a threshold
- **WHEN** Pi requests its follow-up model call
- **THEN** the runtime compresses and recounts context before invoking the provider

#### Scenario: A single current input cannot fit
- **GIVEN** the current user input and mandatory context cannot fit after forced compression
- **WHEN** the context is recounted
- **THEN** the run ends with `limit_reached/context_window` without truncating the current input or invoking the main Agent model

### Requirement: Forced summaries follow a validated V1 schema
Each thread SHALL have at most one `AgentContextSummary`. Its V1 content SHALL contain user goals, user constraints, decisions, sourced facts, open questions, pending tasks, untrusted tool findings, referenced artifacts, recent outcome, and compression notes. Server metadata SHALL record revision, covered message boundary, model, schema version, prompt hash, token counts, and timestamps. Original messages MUST remain unchanged.

#### Scenario: A valid summary replaces the prior thread summary
- **GIVEN** a thread already has a context summary
- **WHEN** a newer summary passes schema validation
- **THEN** the server transactionally overwrites the single summary row, increments its revision, advances its covered boundary, and publishes a metadata-only compression event

#### Scenario: Summary generation fails twice
- **GIVEN** the current model returns invalid structured output and one retry also fails
- **WHEN** forced compression cannot produce a valid summary
- **THEN** the prior summary remains unchanged, no main Agent call occurs, and the run ends with `limit_reached`, reason `context_window`, and code `AGENT_CONTEXT_COMPRESSION_FAILED`

### Requirement: Context state is visible and replayable
The Agent event protocol SHALL expose persisted `context-budget` updates containing used, usable, and maximum context tokens, whether the value is estimated, the active compression level, and optional summary ID. It SHALL expose metadata-only `context-compressed` events. The Web application SHALL display current context occupancy near the Composer, compression events in the timeline, and the latest structured summary in a detail view.

#### Scenario: Estimated occupancy is displayed
- **GIVEN** a provider-specific tokenizer is unavailable
- **WHEN** the UI renders the latest context budget event
- **THEN** it labels the percentage as approximate and restores the same state after event-cursor reconnection

### Requirement: Media references survive compression without binary context
The public Agent message contract SHALL support a `media-reference` part with a stable media ID, media type, MIME type, name, source, status, and description. Binary image/video data MUST NOT be persisted in message JSON or embedded into compressed text; compression SHALL emit a bounded placeholder retaining the reference metadata.

#### Scenario: Light compression encounters a video
- **GIVEN** history contains a video media reference
- **WHEN** light compression runs
- **THEN** the next model context contains a bounded video placeholder and not the video bytes

### Requirement: Tool risk is explicit and enforced outside the prompt
Every registered Agent tool SHALL declare a risk level and approval policy. Until an approval flow exists, the V1 registry SHALL reject tools requiring explicit approval. The system prompt SHALL summarize only tools that the registry actually accepts, and the model MAY autonomously decide whether to call any accepted tool.

#### Scenario: An MCP write tool is registered before approvals exist
- **GIVEN** a tool declares `write` risk and `explicit` approval
- **WHEN** the V1 registry is constructed
- **THEN** startup rejects the unsupported tool rather than relying on prompt text to prevent execution
