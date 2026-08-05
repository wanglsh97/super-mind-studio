## ADDED Requirements

### Requirement: Users can browse a unified creative library
The system SHALL provide an owner-scoped “我的创作” list containing website and image creations. It SHALL expose type, title, status, cover asset, creation time and expiration state without leaking another user's assets. Video SHALL render as an explicit future empty state until a video producer exists.

#### Scenario: User lists their creations
- **GIVEN** a user owns completed website and image creations
- **WHEN** the user opens 我的创作
- **THEN** the system returns only that user's items and allows filtering by website or image

#### Scenario: User requests another user's creation
- **GIVEN** a creation belongs to user A
- **WHEN** user B requests its detail or asset
- **THEN** the system responds as if the creation does not exist

### Requirement: Creation assets expire after thirty days
Website source/build assets SHALL become unavailable at their recorded expiry time, which is thirty days after archival. The API SHALL hide expired assets even if OSS lifecycle deletion has not completed.

#### Scenario: Expired asset download
- **GIVEN** a website asset has passed its expiresAt timestamp
- **WHEN** its owner requests its content
- **THEN** the API denies the content and returns the creation as expired

### Requirement: Image results are represented as creations
The system SHALL create or update an image Creation when an owner submits an image generation task, and SHALL associate successful result assets with it without changing ImageGenerationTask as the generation source of truth.

#### Scenario: Image generation completes
- **GIVEN** an owner submits an image generation task
- **WHEN** the task succeeds with result images
- **THEN** the owner's creative library shows an image creation whose assets resolve through the existing safe image download path
