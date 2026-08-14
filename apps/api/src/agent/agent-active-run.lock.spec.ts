import { ConflictException, HttpException, HttpStatus } from '@nestjs/common'

import type { RedisService } from '../redis/redis.service'
import { AGENT_ACTIVE_RUN_LOCK_TTL_SECONDS, agentActiveRunLockKey } from './agent.constants'
import { AgentActiveRunLock } from './agent-active-run.lock'

describe('AgentActiveRunLock', () => {
  it('acquires with SET NX EX and releases only matching tokens', async () => {
    const trySetNxEx = jest.fn().mockResolvedValue(true)
    const deleteIfValueEquals = jest.fn().mockResolvedValue(true)
    const lock = new AgentActiveRunLock({
      trySetNxEx,
      deleteIfValueEquals,
    } as unknown as RedisService)

    await expect(lock.tryAcquire('thread-a', 'token-1')).resolves.toBe(true)
    expect(trySetNxEx).toHaveBeenCalledWith(
      agentActiveRunLockKey('thread-a'),
      'token-1',
      AGENT_ACTIVE_RUN_LOCK_TTL_SECONDS,
    )

    await lock.release('thread-a', 'token-1')
    expect(deleteIfValueEquals).toHaveBeenCalledWith(agentActiveRunLockKey('thread-a'), 'token-1')
  })

  it('reports contention when the key already exists', async () => {
    const lock = new AgentActiveRunLock({
      trySetNxEx: jest.fn().mockResolvedValue(false),
    } as unknown as RedisService)

    await expect(lock.tryAcquire('thread-a', 'token-2')).resolves.toBe(false)
  })

  it('fails closed with 503 when Redis is unavailable on acquire', async () => {
    const lock = new AgentActiveRunLock({
      trySetNxEx: jest.fn().mockRejectedValue(new Error('redis down')),
    } as unknown as RedisService)

    await expect(lock.tryAcquire('thread-a', 'token-3')).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
    })
    await expect(lock.tryAcquire('thread-a', 'token-3')).rejects.toBeInstanceOf(HttpException)
  })

  it('scopes lock keys per thread so different threads do not contend', async () => {
    const trySetNxEx = jest.fn().mockResolvedValue(true)
    const lock = new AgentActiveRunLock({ trySetNxEx } as unknown as RedisService)
    await lock.tryAcquire('thread-a', 't1')
    await lock.tryAcquire('thread-b', 't2')
    expect(trySetNxEx).toHaveBeenNthCalledWith(
      1,
      agentActiveRunLockKey('thread-a'),
      't1',
      expect.any(Number),
    )
    expect(trySetNxEx).toHaveBeenNthCalledWith(
      2,
      agentActiveRunLockKey('thread-b'),
      't2',
      expect.any(Number),
    )
  })

  it('builds a conflict that identifies the existing active run', () => {
    const lock = new AgentActiveRunLock({} as RedisService)
    const error = lock.threadConflict('run-existing')
    expect(error).toBeInstanceOf(ConflictException)
    expect(error.getResponse()).toEqual(
      expect.objectContaining({
        message: '当前会话已有进行中的 Agent 运行，请等待其结束',
        details: { code: 'AGENT_THREAD_ACTIVE_RUN', activeRunId: 'run-existing' },
      }),
    )
  })

  it('keeps the stable Thread conflict code when the active run id is not observable yet', () => {
    const lock = new AgentActiveRunLock({} as RedisService)
    const error = lock.threadConflict()
    expect(error.getResponse()).toEqual(
      expect.objectContaining({ details: { code: 'AGENT_THREAD_ACTIVE_RUN' } }),
    )
  })

  it('builds a user concurrency-limit conflict', () => {
    const lock = new AgentActiveRunLock({} as RedisService)
    const error = lock.userLimit(2)
    expect(error.getResponse()).toEqual(
      expect.objectContaining({
        details: { code: 'AGENT_USER_CONCURRENCY_LIMIT', limit: 2 },
      }),
    )
  })
})
