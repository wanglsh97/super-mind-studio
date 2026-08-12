export const MAX_DOCUMENT_FILE_COUNT = 5;
export const MAX_DOCUMENT_FILE_BYTES = 20 * 1024 * 1024;

export const SUPPORTED_DOCUMENT_EXTENSIONS = ['.pdf', '.docx', '.xlsx'] as const;
export type SupportedDocumentExtension = (typeof SUPPORTED_DOCUMENT_EXTENSIONS)[number];

export class DocumentFilePolicyError extends Error {
  constructor(
    readonly code:
      | 'DOCUMENT_FILE_COUNT_EXCEEDED'
      | 'DOCUMENT_FILE_TOO_LARGE'
      | 'DOCUMENT_FILE_TYPE_UNSUPPORTED'
      | 'DOCUMENT_FILE_NAME_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'DocumentFilePolicyError';
  }
}

export interface DocumentFileMetadata {
  originalName: string;
  sizeBytes: number;
}

export function validateDocumentFiles(files: readonly DocumentFileMetadata[]): void {
  if (files.length > MAX_DOCUMENT_FILE_COUNT) {
    throw new DocumentFilePolicyError(
      'DOCUMENT_FILE_COUNT_EXCEEDED',
      `最多同时上传 ${MAX_DOCUMENT_FILE_COUNT} 个文档`,
    );
  }
  for (const file of files) validateDocumentFile(file);
}

export function validateDocumentFile(file: DocumentFileMetadata): SupportedDocumentExtension {
  const name = file.originalName.trim();
  if (!name || name.includes('\0') || name.includes('/') || name.includes('\\')) {
    throw new DocumentFilePolicyError('DOCUMENT_FILE_NAME_INVALID', '文件名不合法');
  }
  if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0) {
    throw new DocumentFilePolicyError('DOCUMENT_FILE_TOO_LARGE', '文件大小不合法');
  }
  if (file.sizeBytes > MAX_DOCUMENT_FILE_BYTES) {
    throw new DocumentFilePolicyError(
      'DOCUMENT_FILE_TOO_LARGE',
      `单个文件不能超过 ${MAX_DOCUMENT_FILE_BYTES / 1024 / 1024} MB`,
    );
  }
  const extension = extensionOf(name);
  if (!SUPPORTED_DOCUMENT_EXTENSIONS.includes(extension as SupportedDocumentExtension)) {
    throw new DocumentFilePolicyError(
      'DOCUMENT_FILE_TYPE_UNSUPPORTED',
      '仅支持 PDF、DOCX 和 XLSX 文件',
    );
  }
  return extension as SupportedDocumentExtension;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot).toLowerCase();
}
