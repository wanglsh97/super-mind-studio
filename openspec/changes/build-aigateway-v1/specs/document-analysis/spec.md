## ADDED Requirements

### Requirement: Agent supports temporary document analysis
The system SHALL allow an authenticated user to upload up to five PDF, DOCX, or XLSX files with a maximum size of 20 MB per file into the current sandbox. The files SHALL not be uploaded to OSS or persisted as business records.

#### Scenario: User uploads supported documents
- **GIVEN** an authenticated user uploads no more than five PDF, DOCX, or XLSX files
- **WHEN** the upload is accepted
- **THEN** the server stores the files in the current sandbox
- **AND** provides sandbox-relative paths to the Agent context
- **AND** does not expose files outside the current sandbox

#### Scenario: User uploads an unsupported or oversized file
- **GIVEN** an upload is not PDF, DOCX, or XLSX, or is larger than 20 MB
- **WHEN** the server validates the upload
- **THEN** the upload is rejected before the file is made available to Agent tools

### Requirement: Existing file tools support document workflows
The existing `read-file`, `write-file`, and `export-file` tools SHALL remain compatible with code files and SHALL additionally support PDF, DOCX, and XLSX using the sandbox's preinstalled Python document libraries. `read-file` SHALL return extracted document content to the model, `write-file` SHALL create or modify the file in place, and `export-file` SHALL export the current file for download.

#### Scenario: Agent analyzes an uploaded document
- **GIVEN** the Agent context contains a sandbox-relative path to a supported document
- **WHEN** the model calls `read-file`
- **THEN** PDF text, DOCX paragraphs/tables, or all XLSX worksheets/cells/formulas are extracted and returned
- **AND** the tool refuses paths outside the current sandbox

#### Scenario: Agent creates or modifies a document
- **GIVEN** the user asks the Agent to create or modify a PDF, DOCX, or XLSX file
- **WHEN** the model calls `write-file`
- **THEN** the file is created or modified directly at the sandbox path
- **AND** the original path remains the only current working version
- **AND** the tool does not execute arbitrary model-provided Python or shell code

### Requirement: Document preview and export respect sandbox lifetime
The Web application SHALL preview PDF files natively, DOCX files with `docx-preview`, and XLSX files with SheetJS-rendered worksheet data. Preview and export requests SHALL verify that the sandbox file still exists, and SHALL fail as expired/not found after sandbox release.

#### Scenario: User previews or downloads a current document
- **GIVEN** the requested document still exists in the current sandbox
- **WHEN** the user previews or exports it
- **THEN** the corresponding format-specific preview or file download is returned

#### Scenario: Sandbox has been released
- **GIVEN** the document's sandbox has been released
- **WHEN** the user previews or downloads the document
- **THEN** the request fails with an expired/not-found result
- **AND** no document content is recovered from persistent storage

### Requirement: Document context is temporary
Document analysis results SHALL remain in the current Agent conversation context and SHALL not be separately persisted. The system SHALL support direct in-place edits without version history, undo, or diff management.

#### Scenario: User continues a document conversation
- **GIVEN** the sandbox and conversation are still active
- **WHEN** the user asks a follow-up analysis or modification
- **THEN** the Agent can use the existing document path and conversation context

#### Scenario: User creates a document without specifying a format
- **GIVEN** the user asks the Agent to create a document without naming PDF, DOCX, or XLSX
- **WHEN** `write-file` creates the document
- **THEN** the default output format is DOCX
