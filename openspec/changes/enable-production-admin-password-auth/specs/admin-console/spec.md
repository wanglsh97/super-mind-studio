## MODIFIED Requirements

### Requirement: Administrator authentication is environment-specific and protected

The API SHALL support the fixed `root/123456` credential when explicitly enabled in development, test, or production.
Successful authentication SHALL create a short-lived signed Session in a Secure, HttpOnly, SameSite=Strict Cookie.
All administrator APIs except login SHALL require that Session. Production templates SHALL keep the fixed credential
disabled by default, while a private production environment MAY explicitly enable it after accepting the documented risk.

#### Scenario: Production administrator signs in

- **GIVEN** production fixed administrator credentials are explicitly enabled
- **WHEN** the administrator submits `root/123456` within the login rate limit
- **THEN** the API returns the administrator Session
- **AND** writes a short-lived Secure and HttpOnly administrator Cookie

#### Scenario: Production fixed credentials are disabled

- **GIVEN** the API is running in production with fixed administrator credentials disabled
- **WHEN** a login is attempted
- **THEN** the API returns service unavailable
- **AND** other public and user-facing capabilities remain available

#### Scenario: Administrator submits an invalid credential

- **GIVEN** fixed administrator credentials are enabled
- **WHEN** the username or password does not match
- **THEN** the API returns the same generic unauthorized response
- **AND** does not reveal which field was incorrect

#### Scenario: Authenticated administrator accesses protected APIs

- **GIVEN** the administrator has a valid short-lived Session
- **WHEN** a protected administrator API is requested
- **THEN** the request is authorized
- **AND** logout clears the Cookie so subsequent protected requests are unauthorized
