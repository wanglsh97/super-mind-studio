## MODIFIED Requirements

### Requirement: The user-facing site supports three independent login providers
The user-facing site SHALL support one-time anonymous login, GitHub OAuth, and Google OAuth. Each login identity SHALL
map to exactly one local User by `(authProvider, providerUserId)`. Identities from different providers SHALL never be
bound, merged, or matched by email.

#### Scenario: GitHub and Google return the same email
- **GIVEN** a GitHub identity and a Google identity expose the same verified email
- **WHEN** both identities log in
- **THEN** the API creates two different local Users
- **AND** each User retains its own provider and provider user ID

#### Scenario: Existing OAuth identity logs in again
- **GIVEN** a User already exists for one provider and provider user ID
- **WHEN** that same OAuth identity logs in again
- **THEN** the API reuses the existing platform User
- **AND** refreshes its mutable name, avatar, email, and last-login time

### Requirement: User data is provider-neutral
The API SHALL store platform Users with an internal UUID, auth provider, provider user ID, non-unique user name,
optional avatar, optional email, and timestamps. Business services and public Session responses SHALL NOT expose
GitHub-specific fields. `(authProvider, providerUserId)` SHALL be unique.

#### Scenario: Authenticated business request resolves a User
- **GIVEN** a valid Session created by any supported login method
- **WHEN** a protected business API loads the current User
- **THEN** it receives the platform UUID and generic public profile
- **AND** authorization does not branch on GitHub, Google, or anonymous profile fields

### Requirement: Anonymous login creates an unrecoverable one-time identity
`POST /api/v1/auth/anonymous` SHALL create a new anonymous User and fixed-expiry Session on every successful call. It
SHALL NOT accept or derive a device fingerprint, persist an anonymous credential in Web storage, or recover a prior
anonymous User after Session loss.

#### Scenario: Anonymous login is repeated
- **GIVEN** the same browser performs anonymous login, loses or replaces its Session, and performs anonymous login again
- **WHEN** the second login completes
- **THEN** the API creates a different User with a different provider user ID
- **AND** the former User and its business data remain stored but inaccessible to the visitor

### Requirement: Anonymous users have the same product capabilities
Anonymous Users SHALL pass the same UserSession authorization boundary and receive the same product capabilities,
rate limits, and persistent data behavior as GitHub and Google Users. Anonymous login SHALL be available in development
and production without an environment feature flag.

#### Scenario: Anonymous User invokes a protected capability
- **GIVEN** a valid anonymous UserSession
- **WHEN** the User invokes Chat, Agent, Image, Prompt, File, or Skill capability
- **THEN** the request is authorized and attributed to the anonymous User UUID
- **AND** no anonymous-specific capability restriction is applied

### Requirement: Google OAuth uses stable OIDC identity
Google login SHALL use Authorization Code flow with `openid profile email`, identify the account only by OIDC `sub`,
and SHALL NOT persist OAuth tokens. Missing or unverified email SHALL NOT prevent login and SHALL be stored as null.

#### Scenario: Google returns an unverified email
- **GIVEN** Google returns a valid stable `sub` and profile with an unverified email
- **WHEN** the callback is processed
- **THEN** the API creates or updates the Google User by `sub`
- **AND** stores a null email
- **AND** creates a normal UserSession

### Requirement: OAuth providers are independently configurable
Anonymous login SHALL always be enabled. GitHub and Google OAuth SHALL be independently enabled. A disabled provider
SHALL return `AUTH_PROVIDER_DISABLED` without preventing application startup, while an enabled provider with incomplete
credentials SHALL fail configuration validation.

#### Scenario: Google is disabled
- **GIVEN** Google OAuth is disabled and anonymous login remains available
- **WHEN** a visitor starts Google login
- **THEN** the API returns a retryable-false provider-disabled error
- **AND** anonymous and any independently enabled provider continue to operate

### Requirement: Application sessions are shared across login providers
All login methods SHALL use the same database UserSession and HttpOnly Cookie contract with fixed 30-day expiry.
Successful login SHALL create a new Session and overwrite the browser Cookie without proactively revoking an older
Session. Logout SHALL revoke only the Session referenced by the current Cookie.

#### Scenario: Browser replaces an existing login
- **GIVEN** a browser already has a valid UserSession
- **WHEN** another login method succeeds
- **THEN** the browser Cookie points to the newly created Session
- **AND** the prior Session record remains valid until revoked or expired

### Requirement: Administrator logs use generic user identity
Authenticated administrator request-log APIs SHALL expose generic user summaries and support filtering by auth
provider, user name, or exact provider user ID. Ordinary Session and public responses SHALL NOT expose provider user ID
or email.

#### Scenario: Administrator filters logs by Google identity
- **GIVEN** request logs exist for anonymous, GitHub, and Google Users
- **WHEN** an administrator filters by `GOOGLE` and an exact provider user ID
- **THEN** only the matching Google User's logs are returned
- **AND** public Session responses still omit provider user ID and email
