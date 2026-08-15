## ADDED Requirements

### Requirement: Reference images are uploaded directly to temporary private OSS
When a reference image is selected, the API SHALL validate the owning Thread and upload it directly to a private `video-staging/` OSS object. It SHALL NOT create a Sandbox copy, permanent Creation or My Creations entry. Client state SHALL use an opaque asset ID and SHALL never receive an object key or signed URL.

#### Scenario: User uploads a first-frame image
- **GIVEN** an authenticated user is in video mode
- **WHEN** a valid image is selected
- **THEN** the API stores it as a private temporary OSS object and returns an opaque asset ID
- **AND** no Sandbox file or Creation is created

#### Scenario: User replaces an unsubmitted image
- **GIVEN** an uploaded image is not referenced by any submitted task
- **WHEN** the user replaces or clears it
- **THEN** the service removes the unused staging object best-effort without affecting historical task inputs

### Requirement: Bailian reads reference images through temporary private OSS
The API SHALL issue a read-only signed HTTPS URL for the validated private staging object, with a default validity of 30 minutes and an absolute maximum of two hours. The staging object SHALL NOT create a Creation or appear in My Creations. Unsubmitted replacement/removal and platform terminal states SHALL trigger best-effort deletion, and the bucket SHALL apply a one-day lifecycle rule as crash-recovery cleanup.

#### Scenario: Provider reads a valid first frame
- **GIVEN** a submitted task owns a live first-frame Sandbox asset
- **WHEN** the platform prepares a URL-only Bailian request
- **THEN** it creates a private task-scoped staging object and supplies a short-lived signed HTTPS URL
- **AND** no permanent Creation is created

#### Scenario: Video task reaches a terminal state
- **GIVEN** a staging object was created for a video task
- **WHEN** the task succeeds, fails, times out or is cancelled
- **THEN** the service deletes the staging object best-effort
- **AND** the bucket lifecycle rule removes any orphan no later than its configured retention window

### Requirement: Provider video downloads are bounded and SSRF-safe
Provider success SHALL pass through a controlled streaming downloader before platform success. A video SHALL be at most 500 MB and SHALL be validated as an MP4 by allowlisted HTTPS host, DNS/IP policy, redirect policy, Content-Length, MIME, file signature, duration and media metadata. The downloader SHALL calculate SHA-256 and remove partial files on failure.

#### Scenario: Valid provider MP4 is persisted
- **GIVEN** a provider reports success with an approved result URL
- **WHEN** the downloader streams a valid MP4 within the size limit
- **THEN** the file is committed under a controlled Thread Sandbox output path with digest and media metadata

#### Scenario: Provider result is unsafe or oversized
- **GIVEN** a result resolves to a private address, disallowed redirect, non-MP4 body or more than 500 MB
- **WHEN** it is downloaded
- **THEN** the task fails, the partial file is removed and no bytes are proxied to the user

#### Scenario: A successful provider result is briefly unavailable

- **GIVEN** the provider task is successful and returns one immutable result URL
- **WHEN** the CDN connection fails transiently while the platform is persisting that result
- **THEN** the platform retries only that result download a bounded number of times
- **AND** it does not resubmit generation, switch provider or create another paid task

#### Scenario: Concurrent waiters observe the same successful task

- **GIVEN** more than one recovery or foreground waiter observes provider success
- **WHEN** one waiter atomically moves the task into persistence
- **THEN** other waiters observe the committed terminal state and cannot overwrite success with a stale failure

### Requirement: V1 does not transcode video
The platform SHALL store and serve the validated provider MP4 without FFmpeg transcoding. A result that is not compatible with the accepted MP4/browser media profile SHALL fail rather than consume Sandbox resources for conversion.

#### Scenario: Provider returns an incompatible media encoding
- **GIVEN** the downloaded container or tracks fail the accepted media checks
- **WHEN** persistence validation completes
- **THEN** the task fails and no converted derivative is created

### Requirement: Temporary video preview is owner-scoped and seekable
A successful unsaved video SHALL be previewed only through an authenticated same-origin route that validates user, Thread, task and live Sandbox ownership. The route SHALL support HTTP Range and 206 responses and SHALL not expose the provider URL or Sandbox path. A modal preview SHALL stop playback when closed without deleting the file.

#### Scenario: Owner seeks in a temporary video
- **GIVEN** the owner's Sandbox video is live
- **WHEN** the browser requests a valid byte range
- **THEN** the API returns 206 with correct range, length, private-cache and `video/mp4` headers

#### Scenario: Sandbox has expired
- **GIVEN** an unsaved video no longer exists with its Thread Sandbox
- **WHEN** the message or preview is opened
- **THEN** the UI reports that the temporary video expired and the API returns no asset bytes

### Requirement: Save permanently creates one video Creation
Saving a successful temporary video SHALL idempotently write a private OSS object and create a permanent VIDEO Creation and CreationAsset. Each saved generated version SHALL be a separate Creation with Thread, Run, sequence and optional parent-version metadata. Repeated save operations for the same task SHALL return the existing asset.

#### Scenario: User saves a temporary video
- **GIVEN** a live successful Sandbox video has not been saved
- **WHEN** its owner chooses 保存
- **THEN** the validated bytes are stored in private OSS and one permanent VIDEO Creation is committed

#### Scenario: Save transaction fails after object upload
- **GIVEN** a new OSS object was written but database commit fails
- **WHEN** compensation runs
- **THEN** the temporary video remains usable, no false saved result is returned and the new object is cleaned up best-effort

### Requirement: Download saves before sending the local attachment
Downloading a temporary video SHALL first execute the same idempotent permanent-save path, then send the saved asset to the user's device. A downloaded video SHALL therefore appear in My Creations. A local download failure SHALL NOT roll back an already committed Creation.

#### Scenario: User downloads an unsaved video
- **GIVEN** a successful Sandbox video is not yet permanent
- **WHEN** its owner chooses 下载
- **THEN** the service creates or reuses its permanent Creation and then returns an attachment response

#### Scenario: Browser download fails after save
- **GIVEN** the permanent Creation committed successfully
- **WHEN** the browser fails to complete the local download
- **THEN** the Creation remains in My Creations and the user can retry download without another upload

### Requirement: Saved videos remain until owner deletion
Saved VIDEO Creations and OSS objects SHALL have no automatic expiry. My Creations SHALL show each saved version as an independent card with owner-scoped preview, download and delete. Deletion SHALL use a retryable deleting state so an OSS failure does not silently orphan a large object. Deleting one version SHALL not affect other versions.

#### Scenario: Saved video outlives the Sandbox
- **GIVEN** a video was saved before the Thread Sandbox expired
- **WHEN** the Sandbox is later destroyed
- **THEN** the owner can still preview and download the video through its permanent asset route

#### Scenario: Owner deletes a saved video
- **GIVEN** the user owns a permanent VIDEO Creation
- **WHEN** deletion is requested
- **THEN** the Creation enters controlled deletion, the OSS object is removed with retry semantics and unrelated versions remain available

### Requirement: Asset routes and metadata do not leak infrastructure details
SDK responses, Web messages and logs SHALL not expose provider result URLs, signed input tokens, OSS credentials/object keys or Sandbox paths. Object keys SHALL be generated from opaque identifiers and SHALL not contain Prompt text.

#### Scenario: Another user requests an asset
- **GIVEN** a temporary or permanent video belongs to another user
- **WHEN** preview, save, download or delete is requested
- **THEN** the operation is denied without revealing whether the internal object or Sandbox file exists
