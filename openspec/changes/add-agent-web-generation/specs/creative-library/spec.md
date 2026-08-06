## ADDED Requirements

### Requirement: Users can browse a unified owner-scoped creative library
The system SHALL provide a “我的创作” list containing only the owner's successful current website deliveries and image creations. It SHALL support website/image filtering and an explicit future video empty state without leaking another user's records or assets.

#### Scenario: User lists creations
- **GIVEN** a user owns a successfully delivered website and image tasks
- **WHEN** the user opens 我的创作
- **THEN** the list contains only that user's items and only one current card for each website Thread

### Requirement: Website cards expose only current expiring downloads
A website creation card SHALL expose its current source/build ZIP through generic same-origin Creation Asset routes. The attachment names SHALL be derived from the validated Sandbox `package.json.name` as `<package-name>.zip` and `<package-name>-dist.zip`; a legacy `source.zip` record SHALL recover the same source filename from the archived root manifest when downloaded. It SHALL NOT expose an archived website preview, old delivery, persistent OSS URL or rollback action.

#### Scenario: Current asset is downloaded
- **GIVEN** a current asset belongs to the authenticated user and has not expired
- **WHEN** its generic asset route is requested
- **THEN** the API serves it as a private attachment

#### Scenario: Asset is old, expired or owned by another user
- **GIVEN** an asset is no longer current, has expired or belongs to another user
- **WHEN** it is requested
- **THEN** the API responds without revealing its content or ownership

### Requirement: Successful overwrite resets website retention
The current website source/build assets SHALL expire thirty days after the most recent successful `create_website` delivery. Failed modification attempts SHALL NOT change that timestamp.

#### Scenario: Website is successfully overwritten
- **GIVEN** a current delivery has an earlier expiry
- **WHEN** a replacement delivery succeeds
- **THEN** both replacement assets and their Creation record receive a new thirty-day expiry

### Requirement: Image results remain represented as creations
The system SHALL continue to project image generation results into the same list without changing ImageGenerationTask as their generation source of truth.

#### Scenario: Image generation completes
- **GIVEN** an owner has a successful image generation task
- **WHEN** the creative library is loaded
- **THEN** its image creation appears and resolves content through the existing safe image route
