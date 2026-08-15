## ADDED Requirements

### Requirement: Image generation is an Agent run mode
The Web SHALL place “图像生成” beside the existing Composer capability entries and SHALL submit the existing Agent Run API with `mode: image`. The Composer SHALL continue to select the outer text model, and selecting image mode SHALL NOT replace or mutate the Thread text-model binding.

#### Scenario: User enters image mode
- **GIVEN** an authenticated user is viewing an idle Thread
- **WHEN** the user selects 图像生成 and submits a Prompt
- **THEN** the server admits a normal Agent Run with the selected text model and `image` mode
- **AND** the same Thread, SSE, cancellation and concurrency lifecycle is used

#### Scenario: User leaves image mode
- **GIVEN** `image` mode is selected for a Thread
- **WHEN** the user explicitly exits that mode
- **THEN** later Runs use the normal Agent profile without changing the Thread text model

### Requirement: Image mode automatically activates the built-in gen-image Skill
Every `image` Run SHALL load the immutable repository-owned `gen-image` Skill before the first model call and include its instructions with the user Prompt. The API SHALL validate and cache the Skill at startup, SHALL NOT expose it for user editing, and SHALL NOT load it for a normal Run.

#### Scenario: Image Run is assembled
- **GIVEN** an `image` Run passed admission
- **WHEN** the server assembles its model context and Tool registry
- **THEN** the complete validated `gen-image` Skill and `generate_image` Tool are active before the first model call
- **AND** the current enabled image-model capabilities are supplied from the server catalog

#### Scenario: Built-in Skill is invalid
- **GIVEN** the `gen-image` package is missing, malformed or inconsistent with its declared name
- **WHEN** the API starts
- **THEN** startup fails instead of serving a partial `image` mode

#### Scenario: Normal Run is assembled
- **GIVEN** a Run is not in `image` mode
- **WHEN** its model context and Tool registry are assembled
- **THEN** the `gen-image` instructions and `generate_image` Tool are absent

### Requirement: Agent invokes a constrained generate_image Tool
The `generate_image` Tool SHALL accept a Prompt, optional platform image model, optional owner-scoped reference image identifier and optional supported aspect-ratio, quality and watermark settings. It MUST reject provider identifiers, upstream model identifiers, arbitrary URLs, arbitrary filesystem paths, output count and parameters outside the resolved model capability declaration. One Agent Run SHALL create at most one image task and exactly one output image.

#### Scenario: User provides only a Prompt
- **GIVEN** the user did not name an image model or setting
- **WHEN** the Agent calls `generate_image` with the interpreted Prompt
- **THEN** the server uses the model configured by `BAILIAN_IMAGE_DEFAULT_MODEL`, 1:1, 2K, one image and watermark disabled without asking the user for missing settings

#### Scenario: Agent submits untrusted execution fields
- **GIVEN** a Tool call contains an upstream model ID, provider, URL, Sandbox path, count or unsupported option
- **WHEN** the Tool validates its arguments
- **THEN** it rejects the call before creating a paid provider task

#### Scenario: Agent calls the Tool twice in one Run
- **GIVEN** the Run already created an ImageGenerationTask
- **WHEN** the model emits another `generate_image` call in the same Run
- **THEN** the server rejects the duplicate without calling the provider again

### Requirement: Image editing uses one valid prior Thread image
The Tool SHALL support image-to-image continuation by resolving only an owner-scoped image identifier from the same Thread. When the user asks to modify the current creation without explicitly selecting a reference, the platform SHALL use the previous valid image in that creation chain. It SHALL NOT send all Thread images or a local Sandbox path to the provider.

#### Scenario: User continues from the latest image
- **GIVEN** the current Thread has a previous unexpired image-generation result
- **WHEN** the user asks to modify it in a new `image` Run
- **THEN** the Tool submits that one image as the reference and creates a new child task

#### Scenario: User changes the image model
- **GIVEN** the referenced image is valid and the user explicitly requests another enabled platform image model
- **WHEN** the Agent calls the Tool with that model
- **THEN** the Tool uses the requested model without an additional model-switch warning

#### Scenario: Reference is expired or not owned
- **GIVEN** the reference belongs to another user or Thread, or its Sandbox file has expired
- **WHEN** the Tool resolves it
- **THEN** the Tool rejects the request without exposing the path, content or ownership details

### Requirement: Image Tool results are first-class Agent message parts
The Agent event and message contract SHALL persist a structured image-generation Tool call and result containing task/image identifiers, actual platform and upstream model, original/effective Prompt, effective settings, controlled image routes, Sandbox expiry, available alternatives and adjustable capabilities. The Web SHALL render this structure directly and MUST NOT depend on a provider URL or an image URL copied into Markdown.

The structured Tool result SHALL include follow-up suggestions for supported aspect ratios, qualities, and alternative models. The Web SHALL render these suggestions as grouped action bubbles. Selecting a bubble SHALL append its structured Prompt as a user message and immediately start the normal Agent Run lifecycle for the current Thread.

#### Scenario: User selects a structured image adjustment

- **GIVEN** a successful image result exposes follow-up suggestions
- **WHEN** the user selects one aspect-ratio, quality, or model bubble
- **THEN** the Web sends the corresponding Prompt directly in the current Thread
- **AND** the request uses the normal Thread concurrency and Agent Run controls

#### Scenario: Image task is running
- **GIVEN** the Tool has submitted a provider task
- **WHEN** the user watches or later reopens the Thread
- **THEN** the Tool UI restores the persisted submitting, pending, running or persisting state

#### Scenario: Image generation succeeds
- **GIVEN** the result has been written to the live Thread Sandbox
- **WHEN** the Tool result and final assistant message are rendered
- **THEN** the user can preview, download, save or continue from the image
- **AND** the assistant identifies the actual image model and suggests enabled alternatives and supported adjustments

#### Scenario: Image generation fails or expires
- **GIVEN** the task reaches failed, cancelled, expired or submission-unknown state
- **WHEN** the Thread is rendered
- **THEN** the structured failure remains visible and no automatic image-model failover or duplicate task occurs

### Requirement: Image generation shares Agent admission and cancellation
Image generation SHALL count as the enclosing Agent Run. A Thread SHALL have at most one active Run, and one user SHALL have at most five active Threads across text and image Runs. Cancellation SHALL stop client reading immediately, persist cancellation intent and best-effort cancel the provider without promising that provider work or cost was reversed.

#### Scenario: Same Thread is already active
- **GIVEN** a text or image Agent Run is active in a Thread
- **WHEN** the user attempts another Run in that Thread
- **THEN** the existing server-side admission guard rejects it

#### Scenario: User has five active Threads
- **GIVEN** the user has active Runs in five different Threads
- **WHEN** the user starts another text or image Run in a sixth Thread
- **THEN** admission rejects it before creating or calling a provider task

#### Scenario: User stops image generation
- **GIVEN** an image provider task has been submitted
- **WHEN** the user activates Stop
- **THEN** the page stops waiting, the Run records cancellation, and the platform attempts upstream cancellation
- **AND** the UI states that provider cost may still occur
