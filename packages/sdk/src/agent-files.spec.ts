import assert from 'node:assert/strict'
import test from 'node:test'

import { parseAgentOutputFileReference } from './agent-files.js'

const fileId = '00000000-0000-4000-8000-000000000001'
const base = `/api/v1/agent/files/${fileId}/content`
const valid = {
  fileId,
  name: 'logo.svg',
  mimeType: 'image/svg+xml',
  size: 42,
  sha256: 'a'.repeat(64),
  path: '/workspace/output/logo.svg',
  contentUrl: base,
  downloadUrl: `${base}?download=1`,
}

test('parses a stable same-origin Agent output file reference', () => {
  assert.deepEqual(parseAgentOutputFileReference(valid), {
    fileId,
    name: 'logo.svg',
    mimeType: 'image/svg+xml',
    sizeBytes: 42,
    sha256: 'a'.repeat(64),
    path: '/workspace/output/logo.svg',
    contentUrl: base,
    downloadUrl: `${base}?download=1`,
  })
})

test('rejects signed or cross-origin artifact URLs', () => {
  assert.equal(
    parseAgentOutputFileReference({
      ...valid,
      contentUrl: 'https://private-oss.invalid/signed',
    }),
    null,
  )
  assert.equal(parseAgentOutputFileReference({ ...valid, size: -1 }), null)
})
