import assert from 'node:assert/strict';
import test from 'node:test';

import { readImageMode, writeImageMode } from './image-mode-state';

test('persists image mode independently per Thread', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  writeImageMode(storage, 'thread-a', true);
  assert.equal(readImageMode(storage, 'thread-a'), true);
  assert.equal(readImageMode(storage, 'thread-b'), false);
  writeImageMode(storage, 'thread-a', false);
  assert.equal(readImageMode(storage, 'thread-a'), false);
});
