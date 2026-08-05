## ADDED Requirements

### Requirement: Website artifacts use a separate expiring creation namespace
The system SHALL store website project artifacts under a private creation namespace with a thirty-day expiry rather than treating them as permanent generic Agent output files. The owner-facing API SHALL return same-origin content and download routes and MUST NOT expose a persistent OSS URL.

#### Scenario: Artifact storage route remains private
- **GIVEN** a website artifact has been archived
- **WHEN** its owner requests a download before expiry
- **THEN** the system authorizes ownership and serves or redirects to a fresh short-lived object URL without persisting that URL
