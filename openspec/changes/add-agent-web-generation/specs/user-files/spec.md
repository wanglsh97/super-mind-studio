## ADDED Requirements

### Requirement: Website delivery assets use a private replaceable creation namespace
The system SHALL write each successful website delivery to new private temporary object keys, validate both ZIP files and atomically switch the current CreationAsset pointers before best-effort deletion of the replaced objects. Only the current assets SHALL be downloadable, and no persistent OSS URL SHALL be stored or returned.

#### Scenario: New delivery replaces old objects
- **GIVEN** a WebProject already references valid source and dist assets
- **WHEN** a new delivery has been fully uploaded and validated
- **THEN** one database transaction makes both new assets current and resets expiry before the old object keys are deleted

#### Scenario: Upload or transaction fails
- **GIVEN** the previous delivery is current
- **WHEN** any new object upload, validation or database switch fails
- **THEN** the previous database pointers remain current and newly written temporary objects are cleaned up best-effort
