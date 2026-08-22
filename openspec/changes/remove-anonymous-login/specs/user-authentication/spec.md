## MODIFIED Requirements

### Requirement: The user-facing site supports stable OAuth accounts only
The user-facing site SHALL support GitHub OAuth and Google OAuth. Each OAuth identity SHALL map to exactly one local
User by `(authProvider, providerUserId)`. The site SHALL NOT offer anonymous login or create anonymous identities.

#### Scenario: Visitor opens the login page
- **GIVEN** a visitor has no valid UserSession
- **WHEN** the visitor opens `/login`
- **THEN** the page offers GitHub and Google OAuth
- **AND** it does not offer an anonymous or temporary-account action

#### Scenario: A client calls the removed anonymous route
- **GIVEN** no anonymous login route is registered
- **WHEN** a client posts to `/api/v1/auth/anonymous`
- **THEN** the API returns 404
- **AND** no User or UserSession is created

### Requirement: Protected user capabilities require a recoverable account
The API SHALL authorize user capabilities only for valid GitHub or Google UserSessions. A legacy anonymous Session SHALL
be rejected and revoked at the shared Session boundary. Historical anonymous Users and business records MAY remain for
audit and later data-governance decisions.

#### Scenario: Legacy anonymous Session accesses a protected capability
- **GIVEN** a UserSession belongs to a historical `ANONYMOUS` User
- **WHEN** the Session is validated
- **THEN** the API returns 401
- **AND** revokes that Session
- **AND** the protected capability does not execute

### Requirement: OAuth identities remain provider-scoped
GitHub and Google identities SHALL remain unique by `(authProvider, providerUserId)` and SHALL NOT be merged by email.
All successful OAuth logins SHALL use the shared database UserSession and HttpOnly Cookie contract.

#### Scenario: Existing OAuth identity logs in again
- **GIVEN** a User already exists for one OAuth provider and provider user ID
- **WHEN** that identity logs in again
- **THEN** the API reuses the same platform User
- **AND** creates a new valid UserSession
