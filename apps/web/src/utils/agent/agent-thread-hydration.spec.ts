import assert from 'node:assert/strict';
import test from 'node:test';

import type { ThreadMessageLike } from '@assistant-ui/react';

import { resetThreadIfIdle, shouldDetachLocalRun } from './agent-thread-hydration';

const messages: ThreadMessageLike[] = [
  {
    id: 'user-1',
    role: 'user',
    content: [{ type: 'text', text: 'hello' }],
  },
];

test('does not replace the LocalRuntime repository while a run is streaming', () => {
  let resetCalls = 0;

  const applied = resetThreadIfIdle(
    {
      getState: () => ({ isRunning: true }),
      reset: () => {
        resetCalls += 1;
      },
    },
    messages,
  );

  assert.equal(applied, false);
  assert.equal(resetCalls, 0);
});

test('hydrates persisted messages after the LocalRuntime run is idle', () => {
  let received: ThreadMessageLike[] | null = null;

  const applied = resetThreadIfIdle(
    {
      getState: () => ({ isRunning: false }),
      reset: (nextMessages) => {
        received = nextMessages;
      },
    },
    messages,
  );

  assert.equal(applied, true);
  assert.deepEqual(received, messages);
  assert.notEqual(received, messages);
});

test('detaches a running LocalRuntime only when the visible Thread changes', () => {
  assert.equal(shouldDetachLocalRun(true, 'thread-a', null), true);
  assert.equal(shouldDetachLocalRun(true, 'thread-a', 'thread-b'), true);
  assert.equal(shouldDetachLocalRun(true, 'thread-a', 'thread-a'), false);
  assert.equal(shouldDetachLocalRun(false, 'thread-a', 'thread-b'), false);
  assert.equal(shouldDetachLocalRun(true, null, 'thread-b'), false);
});
