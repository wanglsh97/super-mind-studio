## ADDED Requirements

### Requirement: Video generation is a persisted Thread mode
The Web application SHALL provide a video-generation mode above the existing Composer. The mode SHALL be persisted per Thread, SHALL keep the existing selected text model as the outer Agent model and SHALL NOT add a video-model selector. Switching back to conversation mode SHALL prevent ordinary messages from invoking video generation.

#### Scenario: User enters video mode
- **GIVEN** an authenticated user owns a Thread in conversation mode
- **WHEN** the user selects video generation above the Composer
- **THEN** the Thread persists video mode and subsequent messages use the video Agent flow

#### Scenario: First-frame upload creates a Thread

- **GIVEN** the user selected video generation in a new unsent conversation
- **WHEN** uploading a first-frame image creates and opens the Thread
- **THEN** the new Thread inherits video mode before route hydration and the Composer remains in video generation mode

#### Scenario: Submitted first frame is part of the user turn

- **GIVEN** the Composer has an uploaded first-frame asset and a text prompt
- **WHEN** the user submits the video-generation turn
- **THEN** the persisted user message and Agent Run input contain the same opaque first-frame asset reference
- **AND** the conversation renders that image as a separate visual message part rather than silently sending text only
- **AND** the current text-model selection remains unchanged

#### Scenario: User returns to conversation mode
- **GIVEN** a Thread previously generated videos
- **WHEN** the user switches to conversation mode and sends a message
- **THEN** the message uses the normal Agent tool set and does not trigger a paid video task

### Requirement: Video mode automatically loads a built-in Skill and Tool
Every video-mode Run SHALL load the repository-owned video Skill and runtime environment before the first outer-Agent model call and SHALL register a server-owned `generate_video` Tool. Sending a Prompt SHALL authorize direct generation without a confirmation turn. The Tool schema SHALL accept platform semantics only and SHALL reject provider IDs, arbitrary URLs and Sandbox paths.

#### Scenario: Agent generates from text
- **GIVEN** a video-mode Run contains a text Prompt and no reference image
- **WHEN** the outer Agent follows the built-in Skill
- **THEN** it calls `generate_video` with a normalized text-to-video intent
- **AND** the service begins generation without asking the user to confirm

#### Scenario: Model attempts to bypass the Tool boundary
- **GIVEN** a Tool call contains a provider URL, real provider model ID or Sandbox path
- **WHEN** the server validates the call
- **THEN** it rejects the unsafe field and does not submit a paid task

### Requirement: Video requests inherit the latest creation context
A follow-up video Run SHALL inherit the previous effective Prompt, single first-frame image and executable parameters in the same Thread. The new user Prompt SHALL override only explicitly changed intent. A previously generated video SHALL NOT become an input to another generation.

#### Scenario: User modifies a completed video
- **GIVEN** a Thread has a completed video generated from a first-frame image
- **WHEN** the user asks to move the camera closer and change another supported setting
- **THEN** the next request keeps the prior image and unchanged settings and applies the new intent
- **AND** it submits a new text-plus-first-frame generation rather than a video-edit request

#### Scenario: User removes the reference image
- **GIVEN** the current video chain contains a first-frame image
- **WHEN** the user explicitly asks to remove the image and generate only from text
- **THEN** the next Tool request uses the inherited Prompt and effective parameters without the image

### Requirement: Only text-to-video and one first-frame image are supported
The video Agent SHALL support text-to-video and text plus exactly one first-frame image. It SHALL NOT expose start/end frames, subject or style reference, multiple images, reference video, video editing or continuation in this change. A reference image SHALL be interpreted as the first frame and its aspect ratio SHALL take precedence over the text-to-video default.

#### Scenario: User supplies one image
- **GIVEN** a valid same-Thread JPEG, PNG or WEBP image no larger than 10 MB
- **WHEN** the video Run is submitted
- **THEN** the image is treated as the first frame and the provider output follows its approximate aspect ratio

#### Scenario: User asks for an unsupported input mode
- **GIVEN** the user asks for video editing, a last frame or multiple reference subjects
- **WHEN** the Agent prepares the request
- **THEN** it does not activate those input modes and continues through text or single-first-frame generation

### Requirement: One foreground Run is allowed per Thread
The platform SHALL allow at most one foreground Agent Run in a Thread. While a video Run is active, the Composer SHALL not start another Run. A logical cancellation SHALL immediately release this foreground lock even if a provider task continues physically in the background.

#### Scenario: User tries to send while generation is active
- **GIVEN** a video Run is pending, running or persisting
- **WHEN** another message is submitted in the same Thread
- **THEN** the platform rejects or disables the second foreground Run

#### Scenario: User stops generation
- **GIVEN** a provider task is still running
- **WHEN** the user stops the current Run
- **THEN** the Run becomes cancelled, stops emitting results and immediately permits a new Run
- **AND** a late provider success is never shown or persisted to the Sandbox

### Requirement: Completed generation produces structured modification suggestions
After a successful video Tool result, the outer Agent SHALL perform a final text-model turn and return three to five bounded suggestions. Each suggestion SHALL contain only a display label and a user Prompt. The Web SHALL render suggestions as clickable bubbles, and clicking one SHALL append its Prompt as a user message and begin the next video Run.

#### Scenario: Suggestions are rendered
- **GIVEN** a video succeeded with known effective parameters and capabilities
- **WHEN** the final Agent turn completes
- **THEN** the response contains three to five context-relevant structured suggestions
- **AND** the Web renders them as clickable Prompt bubbles rather than current-parameter controls

#### Scenario: Final Agent turn fails
- **GIVEN** the paid video Tool succeeded but the final text-model call fails
- **WHEN** the Run is finalized
- **THEN** the video remains available and the server supplies safe default suggestions
- **AND** no replacement video task is created

### Requirement: Provider identity remains hidden from ordinary users
The SDK and Web SHALL NOT expose the actual video provider, upstream model ID, candidate set, excluded models or model-switch reason. When the Thread binding changes for capability compatibility, the Web MAY display only the generic message “已为你切换到支持当前要求的视频模型”. Provider identity SHALL remain available to authenticated administrators.

#### Scenario: Server changes the bound video model
- **GIVEN** the current bound model cannot execute the new request and another model can
- **WHEN** routing selects and binds the compatible model
- **THEN** the ordinary user sees at most the generic switch notice
- **AND** no response or asset route reveals the actual provider or model ID
