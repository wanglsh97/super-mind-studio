import assert from 'node:assert/strict';
import test from 'node:test';
import {
    bindDraftVideoModeToThread,
    readVideoMode,
    writeVideoMode,
} from './video-mode-state';
test('persists video mode independently per Thread', () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    };
    writeVideoMode(storage, 'thread-1', true);
    assert.equal(readVideoMode(storage, 'thread-1'), true);
    assert.equal(readVideoMode(storage, 'thread-2'), false);
    writeVideoMode(storage, 'thread-1', false);
    assert.equal(readVideoMode(storage, 'thread-1'), false);
});

test('binds a selected draft video mode before a newly created Thread hydrates', () => {
    const map = new Map<string, string>();
    const storage = {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => void map.set(k, v),
        removeItem: (k: string) => void map.delete(k),
    };

    bindDraftVideoModeToThread(storage, 'new-thread', true);

    assert.equal(readVideoMode(storage, 'new-thread'), true);
});
