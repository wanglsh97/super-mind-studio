import assert from 'node:assert/strict'
import test from 'node:test'

import type { ThreadMessageLike } from '@assistant-ui/react'

import { resetThreadIfIdle } from './agent-thread-hydration'

const messages: ThreadMessageLike[] = [
  {
    id: 'user-1',
    role: 'user',
    content: [{ type: 'text', text: 'hello' }],
  },
]

test('does not replace the LocalRuntime repository while a run is streaming', () => {
  let resetCalls = 0

  const applied = resetThreadIfIdle(
    {
      getState: () => ({ isRunning: true }),
      reset: () => {
        resetCalls += 1
      },
    },
    messages,
  )

  assert.equal(applied, false)
  assert.equal(resetCalls, 0)
})

test('hydrates persisted messages after the LocalRuntime run is idle', () => {
  let received: ThreadMessageLike[] | null = null

  const applied = resetThreadIfIdle(
    {
      getState: () => ({ isRunning: false }),
      reset: (nextMessages) => {
        received = nextMessages
      },
    },
    messages,
  )

  assert.equal(applied, true)
  assert.deepEqual(received, messages)
  assert.notEqual(received, messages)
})
