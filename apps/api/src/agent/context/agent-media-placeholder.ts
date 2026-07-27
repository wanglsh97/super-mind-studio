import type { AgentMediaReferencePart } from '@supermind/sdk'

const MAX_MEDIA_FIELD_LENGTH = 240

export function mediaReferencePlaceholder(part: AgentMediaReferencePart): string {
  const fields = [
    `id=${safe(part.mediaId)}`,
    `type=${part.mediaType}`,
    `mime=${safe(part.mimeType)}`,
    `name=${safe(part.name)}`,
    `source=${part.source}`,
    `status=${part.status}`,
    `description=${safe(part.description)}`,
  ]
  return `[media-reference ${fields.join(' ')}]`
}

function safe(value: string): string {
  return JSON.stringify(value.slice(0, MAX_MEDIA_FIELD_LENGTH))
}
