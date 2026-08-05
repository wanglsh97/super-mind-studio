import assert from 'node:assert/strict'
import test from 'node:test'

import { readWebsiteMode, websiteModeStorageKey, writeWebsiteMode } from './website-mode-state'

test('persists website selection independently for a draft and each Thread', () => {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  }

  writeWebsiteMode(storage, null, true)
  writeWebsiteMode(storage, 'thread-a', true)

  assert.equal(readWebsiteMode(storage, null), true)
  assert.equal(readWebsiteMode(storage, 'thread-a'), true)
  assert.equal(readWebsiteMode(storage, 'thread-b'), false)
  assert.notEqual(websiteModeStorageKey(null), websiteModeStorageKey('thread-a'))

  writeWebsiteMode(storage, 'thread-a', false)
  assert.equal(readWebsiteMode(storage, 'thread-a'), false)
  assert.equal(readWebsiteMode(storage, null), true)
})
