## ADDED Requirements

### Requirement: Thread Sandboxes retain temporary images for three hours
The platform SHALL configure all Thread Sandboxes with a three-hour lifetime. An unsaved generated image SHALL exist only in its owning Sandbox and SHALL become unavailable for preview, download and further editing when that Sandbox expires, while its Thread message, task, request log and billing record remain.

#### Scenario: Temporary image is still live
- **GIVEN** a generated image belongs to an unexpired owner Thread Sandbox
- **WHEN** the owner previews, downloads or references it
- **THEN** the API resolves the controlled Sandbox asset without exposing its internal path

#### Scenario: Temporary image expires
- **GIVEN** a generated image was not saved and its three-hour Sandbox expired
- **WHEN** the Thread is reopened or an asset route is requested
- **THEN** the message displays an expired state and the API returns no image bytes or recovery claim

#### Scenario: Non-terminal task reaches Sandbox expiry
- **GIVEN** a submitted image task has not persisted its result before Sandbox expiry
- **WHEN** expiry is reconciled
- **THEN** the platform marks it expired, stops normal polling and attempts provider cancellation without promising cost reversal

### Requirement: Temporary image routes enforce ownership and file safety
Preview and local-download routes SHALL accept only platform image identifiers, verify authenticated user and Thread ownership, resolve a controlled output path inside the live Sandbox and return an allowlisted image type with private, no-sniff headers. They MUST NOT accept arbitrary URLs or filesystem paths.

#### Scenario: Owner previews an image
- **GIVEN** the image is valid, live and owned by the current user
- **WHEN** the preview route is requested
- **THEN** it serves the image privately with a safe content type and without provider or Sandbox credentials

#### Scenario: Another user probes an image
- **GIVEN** the image belongs to another user
- **WHEN** preview or download is requested
- **THEN** the API reveals neither bytes, path, task details nor ownership metadata

### Requirement: Saving to My Creations is explicit and idempotent
The Tool UI SHALL distinguish “下载” from “保存”. Download SHALL send the current temporary image to the user's device without creating a Creation. Save SHALL validate the live Sandbox image, write a new private platform OSS object and atomically create or update an IMAGE Creation and IMAGE CreationAsset owned by the user. Repeated saves of the same image SHALL return the same saved asset rather than duplicate objects or records.

#### Scenario: User downloads without saving
- **GIVEN** a temporary image is live
- **WHEN** the user chooses 下载
- **THEN** the browser receives an attachment and no Creation or OSS object is created

#### Scenario: User saves a temporary image
- **GIVEN** the temporary image is live and not yet saved
- **WHEN** the owner chooses 保存
- **THEN** the API stores the validated bytes in private OSS, commits the Creation/Asset pointers and marks the Tool result saved

#### Scenario: Save fails after object write
- **GIVEN** a new OSS object was written but the database transaction fails
- **WHEN** the save operation unwinds
- **THEN** the temporary image remains usable, no false saved pointer is returned and the new object is cleaned up best-effort

#### Scenario: User repeats save
- **GIVEN** the image already has a committed CreationAsset
- **WHEN** the owner chooses 保存 again or retries after a lost response
- **THEN** the API returns the existing saved asset without creating a duplicate

### Requirement: Saved image creations are permanent owner-scoped assets
Saved image objects and their Creation records SHALL have no automatic expiry. Deleting or expiring the originating Thread Sandbox SHALL NOT delete a saved Creation. The `/creations` page SHALL show saved image creations for their owner and SHALL provide preview and download only; this change SHALL NOT provide delete or continue-creation actions there.

#### Scenario: Saved image outlives its Thread Sandbox
- **GIVEN** an image was saved before the Sandbox expired
- **WHEN** the Sandbox expires or its Thread is deleted
- **THEN** the owner can still view and download the Creation through controlled asset routes

#### Scenario: User opens My Creations
- **GIVEN** the user owns saved and unsaved image results
- **WHEN** `/creations` is loaded
- **THEN** only saved image Creations appear and no delete or continue-creation action is offered

#### Scenario: Another user requests a saved asset
- **GIVEN** a private CreationAsset belongs to another user
- **WHEN** it is previewed or downloaded
- **THEN** the request is denied without exposing the OSS object key or a reusable signed URL

### Requirement: Saved asset metadata avoids sensitive content and provider credentials
OSS object keys SHALL be server-generated from opaque user, Creation and asset identifiers and MUST NOT contain Prompt text. Database metadata MAY store model, dimensions, MIME, byte size and digest, while client responses and logs MUST NOT include API Keys, OSS credentials, provider result URLs or internal Sandbox paths.

#### Scenario: Asset is persisted
- **GIVEN** a successful temporary image is saved
- **WHEN** its OSS key and CreationAsset metadata are created
- **THEN** the key contains no Prompt and the response exposes only owner-scoped platform identifiers and routes
