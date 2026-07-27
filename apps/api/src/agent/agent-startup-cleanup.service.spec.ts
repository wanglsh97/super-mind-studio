import { AgentStartupCleanupService } from './agent-startup-cleanup.service'
import type { AgentRunRepository } from './agent-run.repository'
import type { RedisService } from '../redis/redis.service'
import type { SandboxRuntimePort } from './sandbox/sandbox-runtime.port'

describe('AgentStartupCleanupService', () => {
  it('interrupts abandoned runs and clears active-run Redis locks without replaying work', async () => {
    const interruptAbandonedRuns = jest.fn().mockResolvedValue({
      count: 2,
      runIds: ['run-1', 'run-2'],
    })
    const deleteKeysByPrefix = jest.fn().mockResolvedValue(2)
    const service = new AgentStartupCleanupService(
      { interruptAbandonedRuns } as unknown as AgentRunRepository,
      { deleteKeysByPrefix } as unknown as RedisService,
      sandboxRuntime(),
    )

    await service.onModuleInit()

    expect(interruptAbandonedRuns).toHaveBeenCalledTimes(1)
    expect(deleteKeysByPrefix).toHaveBeenCalledWith('agent:active-run:')
  })

  it('logs and swallows cleanup failures so API startup continues', async () => {
    const service = new AgentStartupCleanupService(
      {
        interruptAbandonedRuns: jest.fn().mockRejectedValue(new Error('db down')),
      } as unknown as AgentRunRepository,
      { deleteKeysByPrefix: jest.fn() } as unknown as RedisService,
      sandboxRuntime(),
    )

    await expect(service.onModuleInit()).resolves.toBeUndefined()
  })

  it('reconciles every expired sandbox and isolates individual destroy failures', async () => {
    const destroySandbox = jest
      .fn()
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce(undefined)
    const sandboxes = sandboxRuntime({
      listLeakedSandboxes: jest
        .fn()
        .mockResolvedValue([{ sandboxId: 'sandbox-1' }, { sandboxId: 'sandbox-2' }]),
      destroySandbox,
    })
    const service = new AgentStartupCleanupService(
      {
        interruptAbandonedRuns: jest.fn().mockResolvedValue({ count: 0, runIds: [] }),
      } as unknown as AgentRunRepository,
      { deleteKeysByPrefix: jest.fn().mockResolvedValue(0) } as unknown as RedisService,
      sandboxes,
    )

    await expect(service.onModuleInit()).resolves.toBeUndefined()
    expect(sandboxes.listLeakedSandboxes).toHaveBeenCalledWith(expect.any(Date))
    expect(destroySandbox).toHaveBeenCalledTimes(2)
    expect(destroySandbox).toHaveBeenNthCalledWith(1, 'sandbox-1')
    expect(destroySandbox).toHaveBeenNthCalledWith(2, 'sandbox-2')
  })

  it('still reconciles sandboxes when PostgreSQL startup cleanup fails', async () => {
    const listLeakedSandboxes = jest.fn().mockResolvedValue([])
    const service = new AgentStartupCleanupService(
      {
        interruptAbandonedRuns: jest.fn().mockRejectedValue(new Error('db down')),
      } as unknown as AgentRunRepository,
      { deleteKeysByPrefix: jest.fn() } as unknown as RedisService,
      sandboxRuntime({ listLeakedSandboxes }),
    )

    await expect(service.onModuleInit()).resolves.toBeUndefined()
    expect(listLeakedSandboxes).toHaveBeenCalledTimes(1)
  })
})

function sandboxRuntime(overrides: Partial<SandboxRuntimePort> = {}): SandboxRuntimePort {
  return {
    listLeakedSandboxes: jest.fn().mockResolvedValue([]),
    destroySandbox: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as SandboxRuntimePort
}
