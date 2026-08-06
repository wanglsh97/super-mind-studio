import type { ConfigService } from '@nestjs/config'

import type { AgentThreadRepository, AgentThreadSandboxRow } from '../agent-thread.repository'
import type { ExecutableSkillService } from '../skills/executable-skill.service'
import {
  MOCK_EXECUTABLE_SKILL_DOWNLOAD,
  MOCK_EXECUTABLE_SKILL_SHA256,
} from '../skills/executable-skill.fixture'
import { AgentExecutionSessionService } from './agent-execution-session.service'
import { createOpenSandboxRuntimeTestDouble } from './open-sandbox-runtime.test'
import type { SandboxRuntimePort } from './sandbox-runtime.port'

function setup(
  options: {
    sandboxes?: SandboxRuntimePort
    prepareActivation?: ExecutableSkillService['prepareActivation']
  } = {},
) {
  const records = new Map<string, AgentThreadSandboxRow>()
  const threads = {
    findSandboxForOwner: jest.fn(async (threadId: string, userId: string) => {
      const row = records.get(threadId)
      return row?.userId === userId ? row : null
    }),
    markSandboxReady: jest.fn(
      async (
        threadId: string,
        userId: string,
        input: { sandboxId: string; createdAt: Date; expiresAt: Date; lastUsedAt?: Date },
      ) => {
        records.set(threadId, {
          id: threadId,
          userId,
          sandboxId: input.sandboxId,
          sandboxStatus: 'ready',
          sandboxCreatedAt: input.createdAt,
          sandboxLastUsedAt: input.lastUsedAt ?? new Date(),
          sandboxExpiresAt: input.expiresAt,
        })
      },
    ),
    markSandboxIdle: jest.fn(async (threadId: string) => {
      const row = records.get(threadId)
      if (row) row.sandboxStatus = 'idle'
    }),
    clearSandbox: jest.fn(async (threadId: string) => {
      records.delete(threadId)
    }),
    listOwnedSandboxes: jest.fn(async () => [...records.values()]),
  } as unknown as AgentThreadRepository
  const skills = {
    prepareActivation:
      options.prepareActivation ??
      jest.fn(async (_userId: string, selected: readonly string[]) => [
        {
          manifest: {
            skillId: `id-${selected[0]}`,
            name: selected[0],
            packageSha256: MOCK_EXECUTABLE_SKILL_SHA256,
          },
          download: MOCK_EXECUTABLE_SKILL_DOWNLOAD,
        },
      ]),
  } as unknown as ExecutableSkillService
  const sandboxes = options.sandboxes ?? createOpenSandboxRuntimeTestDouble()
  const config = {
    get: jest.fn((_key: string, fallback: number) => fallback),
  } as unknown as ConfigService
  const service = new AgentExecutionSessionService(skills, sandboxes, threads, config)
  return { records, sandboxes, service, skills, threads }
}

describe('AgentExecutionSessionService Thread sandbox lifecycle', () => {
  it('installs the immutable static website Skill files into a website Run sandbox', async () => {
    const { service } = setup()
    await service.startRun('run-web', 'thread-web', 'user-1')

    await service.installWebsiteBuildingSkill('run-web', 'user-1')

    await expect(
      service.readFile(
        'run-web',
        'user-1',
        '/workspace/.platform-skills/website-building/SKILL.md',
      ),
    ).resolves.toMatchObject({ sizeBytes: expect.any(Number) })
    const init = await service.readFile(
      'run-web',
      'user-1',
      '/workspace/.platform-skills/website-building/scripts/init.sh',
    )
    const packager = await service.readFile(
      'run-web',
      'user-1',
      '/workspace/.platform-skills/website-building/scripts/package.py',
    )
    const initScript = new TextDecoder().decode(init?.bytes)
    expect(initScript).toContain('npm install --global pnpm@9.15.9')
    expect(initScript).toContain('pnpm create vite@6.5.0')
    expect(new TextDecoder().decode(packager?.bytes)).toContain("excluded_dirs = {'.git'")

    await service.finishRun('run-web')
    await service.destroyThread('thread-web')
  })

  it('keeps base file tools available while resetting per-Run Skill activation', async () => {
    const { service, sandboxes, skills } = setup()
    const createSandbox = jest.spyOn(sandboxes, 'createSandbox')

    const firstSandbox = await service.startRun('run-1', 'thread-1', 'user-1')
    await service.writeFile(
      'run-1',
      'user-1',
      '/workspace/work/shared.txt',
      new TextEncoder().encode('thread-workspace'),
    )
    await service.activateSkill('run-1', 'user-1', 'test-skill')
    await service.finishRun('run-1')

    const secondSandbox = await service.startRun('run-2', 'thread-1', 'user-1')
    expect(secondSandbox).toBe(firstSandbox)
    await expect(
      service.readFile('run-2', 'user-1', '/workspace/work/shared.txt'),
    ).resolves.toMatchObject({ path: '/workspace/work/shared.txt' })
    await service.activateSkill('run-2', 'user-1', 'test-skill')
    expect(createSandbox).toHaveBeenCalledTimes(1)
    expect(createSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-1',
        limits: expect.objectContaining({ sandboxTimeoutMs: 3_600_000 }),
      }),
    )
    expect(skills.prepareActivation).toHaveBeenCalledTimes(2)

    await service.finishRun('run-2')
    await service.destroyThread('thread-1')
  })

  it('isolates different Thread workspaces and rejects cross-user reuse', async () => {
    const { service } = setup()
    const first = await service.startRun('run-1', 'thread-1', 'user-1')
    const second = await service.startRun('run-2', 'thread-2', 'user-1')
    expect(first).not.toBe(second)

    await expect(service.startRun('run-3', 'thread-1', 'user-2')).rejects.toThrow('owner mismatch')
    await service.finishRun('run-1')
    await service.finishRun('run-2')
    await service.destroyThread('thread-1')
    await service.destroyThread('thread-2')
  })

  it('destroys a partially created sandbox when readiness fails', async () => {
    const readyError = new Error('ready timeout')
    const destroySandbox = jest.fn().mockRejectedValue(new Error('temporary network failure'))
    const sandboxes = {
      createSandbox: jest.fn().mockResolvedValue({ sandboxId: 'sandbox-partial' }),
      waitUntilReady: jest.fn().mockRejectedValue(readyError),
      destroySandbox,
    } as unknown as SandboxRuntimePort
    const { service } = setup({ sandboxes })

    await expect(service.startRun('run-1', 'thread-1', 'user-1')).rejects.toBe(readyError)
    expect(destroySandbox).toHaveBeenCalledWith('sandbox-partial')
  })

  it('destroys the retained sandbox when its Thread is deleted', async () => {
    const { service, sandboxes, records } = setup()
    const destroySandbox = jest.spyOn(sandboxes, 'destroySandbox')
    await service.startRun('run-1', 'thread-1', 'user-1')
    await service.finishRun('run-1')

    await service.destroyThread('thread-1')

    expect(destroySandbox).toHaveBeenCalledTimes(1)
    expect(records.has('thread-1')).toBe(false)
  })
})
