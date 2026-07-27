export interface AgentOutputFileReference {
  fileId: string
  name: string
  mimeType: string
  sizeBytes: number
  sha256: string
  path: string
  contentUrl: string
  downloadUrl: string
}

/**
 * Parses the bounded audit projection returned by the server-owned `export_file` tool.
 * OSS signed URLs and cross-origin URLs are deliberately rejected.
 */
export function parseAgentOutputFileReference(value: unknown): AgentOutputFileReference | null {
  if (!isRecord(value)) return null
  const fileId = stringValue(value.fileId)
  const name = stringValue(value.name)
  const mimeType = stringValue(value.mimeType)
  const sizeBytes = value.size
  const sha256 = stringValue(value.sha256)
  const path = stringValue(value.path)
  const contentUrl = stringValue(value.contentUrl)
  const downloadUrl = stringValue(value.downloadUrl)
  if (
    !fileId ||
    !name ||
    !mimeType ||
    typeof sizeBytes !== 'number' ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes < 0 ||
    !sha256 ||
    !/^[a-f0-9]{64}$/.test(sha256) ||
    !path ||
    !contentUrl ||
    !downloadUrl
  ) {
    return null
  }
  const base = `/api/v1/agent/files/${fileId}/content`
  if (contentUrl !== base || downloadUrl !== `${base}?download=1`) return null
  return { fileId, name, mimeType, sizeBytes, sha256, path, contentUrl, downloadUrl }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
