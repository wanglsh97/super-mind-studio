## MODIFIED Requirements

### Requirement: Administrator authentication is environment-specific and protected

The API SHALL support the fixed `root/123456` credential only as an explicitly enabled non-production development
mode. Production MAY enable a separately configured administrator username and `scrypt` password hash, and SHALL NOT
store the production plaintext password. Successful authentication SHALL create a short-lived signed Session in a
Secure, HttpOnly, SameSite=Strict Cookie. All administrator APIs except login SHALL require that Session.

#### Scenario: Production administrator signs in

- **GIVEN** production password authentication is enabled with a valid username and `scrypt-v1` hash
- **WHEN** the administrator submits the matching username and password within the login rate limit
- **THEN** the API returns the administrator Session
- **AND** writes a short-lived Secure and HttpOnly administrator Cookie
- **AND** the plaintext password is not stored in environment, database, logs, or Session claims

#### Scenario: Production configuration attempts to use the development credential

- **GIVEN** the API is starting with `NODE_ENV=production`
- **WHEN** fixed development credentials are enabled
- **THEN** environment validation rejects startup
- **AND** the `root/123456` credential is not exposed

#### Scenario: Production password configuration is incomplete

- **GIVEN** production password authentication is enabled
- **WHEN** the username is missing or the password hash is absent or malformed
- **THEN** environment validation rejects startup without including secret material in the error

#### Scenario: Administrator submits an invalid credential

- **GIVEN** production password authentication is enabled
- **WHEN** the username or password does not match
- **THEN** the API returns the same generic unauthorized response
- **AND** does not reveal which field was incorrect
