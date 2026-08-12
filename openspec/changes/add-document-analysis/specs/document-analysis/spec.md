## ADDED Requirements

### Requirement: Users can upload temporary documents
The system SHALL allow an authenticated user to upload up to five PDF, DOCX, or XLSX files into the current sandbox, with a maximum size of 20 MB per file. Files SHALL NOT be uploaded to OSS or persisted as document business records.

#### Scenario: Supported documents are uploaded
- **GIVEN** the user uploads no more than five PDF, DOCX, or XLSX files within the per-file limit
- **WHEN** the server accepts the upload
- **THEN** it stores the files in the current sandbox
- **AND** injects sandbox-relative paths into the Agent context

#### Scenario: An invalid upload is rejected
- **GIVEN** a file has an unsupported format, exceeds 20 MB, or would exceed five files
- **WHEN** the server validates the upload
- **THEN** it rejects the file before exposing it to file tools

### Requirement: File tools support document analysis and mutation
The existing `read-file`, `write-file`, and `export-file` tools SHALL remain compatible with code files and SHALL support PDF, DOCX, and XLSX. `read-file` SHALL extract content using the sandbox's preinstalled Python libraries; `write-file` SHALL create or modify the file in place; and model-provided arbitrary Python or shell code SHALL NOT be executed.

#### Scenario: The Agent reads a document
- **GIVEN** the Agent receives a sandbox-relative path to a supported document
- **WHEN** it calls `read-file`
- **THEN** PDF text, DOCX paragraphs/tables, or all XLSX worksheets/cells/formulas are returned
- **AND** paths outside the current sandbox are rejected

#### Scenario: The Agent creates or modifies a document
- **GIVEN** the user requests creation or modification of a PDF, DOCX, or XLSX
- **WHEN** the Agent calls `write-file`
- **THEN** the tool creates the file or directly overwrites the existing sandbox file
- **AND** creation defaults to DOCX when no format is specified

### Requirement: Documents can be previewed and exported while the sandbox exists
The Web application SHALL preview PDF natively, DOCX with `docx-preview`, and XLSX with SheetJS-rendered worksheet data. Preview and export SHALL verify the sandbox file on every request.

#### Scenario: A current document is previewed or downloaded
- **GIVEN** the requested file exists in the current sandbox
- **WHEN** the user previews or exports it
- **THEN** the format-specific preview or current file download is returned

#### Scenario: The sandbox has been released
- **GIVEN** the requested file no longer exists because the sandbox was released
- **WHEN** the user previews or exports it
- **THEN** the request returns an expired/not-found result
- **AND** no document content is recovered from persistent storage

### Requirement: Document analysis remains temporary context
The system SHALL keep document analysis results only in the current conversation context and SHALL NOT provide document version history, undo, or diff management.

#### Scenario: A follow-up operation uses the same document
- **GIVEN** the conversation and sandbox remain active
- **WHEN** the user requests follow-up analysis or modification
- **THEN** the Agent can reuse the existing sandbox path and context
