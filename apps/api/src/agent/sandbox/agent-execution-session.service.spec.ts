import type { ExecutableSkillService } from '../skills/executable-skill.service'
import {
  MOCK_EXECUTABLE_SKILL_DOWNLOAD,
  MOCK_EXECUTABLE_SKILL_SHA256,
} from '../skills/executable-skill.fixture'
import { AgentExecutionSessionService } from './agent-execution-session.service'
import { FakeSandboxRuntime } from './fake-sandbox-runtime'
import type { SandboxRuntimePort } from './sandbox-runtime.port'

describe('AgentExecutionSessionService sandbox cleanup', () => {
  it('creates one ready sandbox when a Run starts and reuses it for Skill installation', async () => {
    const skills = {
      prepareActivation: jest.fn().mockResolvedValue([
        {
          manifest: {
            skillId: 'id-test-skill',
            name: 'test-skill',
            packageSha256: MOCK_EXECUTABLE_SKILL_SHA256,
          },
          download: MOCK_EXECUTABLE_SKILL_DOWNLOAD,
        },
      ]),
    } as unknown as ExecutableSkillService
    const sandboxes = new FakeSandboxRuntime()
    const createSandbox = jest.spyOn(sandboxes, 'createSandbox')
    const service = new AgentExecutionSessionService(skills, sandboxes)

    const sandboxId = await service.startRun('run-eager', 'user-1')
    await expect(service.startRun('run-eager', 'user-1')).resolves.toBe(sandboxId)
    await expect(service.activateSkill('run-eager', 'user-1', 'test-skill')).resolves.toMatchObject(
      { sandboxId, alreadyActive: false },
    )
    await expect(
      service.readFile('run-eager', 'user-1', '/workspace/skills/test-skill/scripts/clean.mjs'),
    ).resolves.toMatchObject({
      path: '/workspace/skills/test-skill/scripts/clean.mjs',
      sizeBytes: 21,
    })
    expect(createSandbox).toHaveBeenCalledTimes(1)
    await service.destroyRun('run-eager')
  })

  it('destroys a partially created sandbox when readiness fails', async () => {
    const readyError = new Error('ready timeout')
    const destroySandbox = jest.fn().mockRejectedValue(new Error('temporary network failure'))
    const sandboxes = {
      createSandbox: jest.fn().mockResolvedValue({ sandboxId: 'sandbox-partial' }),
      waitUntilReady: jest.fn().mockRejectedValue(readyError),
      destroySandbox,
    } as unknown as SandboxRuntimePort
    const skills = {
      prepareActivation: jest.fn().mockResolvedValue([
        {
          manifest: {
            skillId: 'id-test-skill',
            name: 'test-skill',
            packageSha256: MOCK_EXECUTABLE_SKILL_SHA256,
          },
          download: MOCK_EXECUTABLE_SKILL_DOWNLOAD,
        },
      ]),
    } as unknown as ExecutableSkillService
    const service = new AgentExecutionSessionService(skills, sandboxes)

    await expect(service.activateSkill('run-1', 'user-1', 'test-skill')).rejects.toBe(readyError)
    expect(destroySandbox).toHaveBeenCalledWith('sandbox-partial')
  })

  it('shares one sandbox across all added Skills without a separate active-Skill limit', async () => {
    const names = Array.from({ length: 50 }, (_, index) => `skill-${index}`)
    const skills = {
      prepareActivation: jest.fn(async (_userId: string, selected: readonly string[]) => [
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
    const sandboxes = new FakeSandboxRuntime()
    const createSandbox = jest.spyOn(sandboxes, 'createSandbox')
    const service = new AgentExecutionSessionService(skills, sandboxes)

    for (const name of names) {
      await expect(service.activateSkill('run-many', 'user-1', name)).resolves.toMatchObject({
        skill: { manifest: { name } },
        alreadyActive: false,
      })
    }
    await expect(service.activateSkill('run-many', 'user-1', names[0]!)).resolves.toMatchObject({
      alreadyActive: true,
    })
    expect(createSandbox).toHaveBeenCalledTimes(1)
    expect(skills.prepareActivation).toHaveBeenCalledTimes(50)
    await service.destroyRun('run-many')
  })

  it('isolates workspaces between Runs and rejects cross-user reuse', async () => {
    const skills = {
      prepareActivation: jest.fn(async (_userId: string, selected: readonly string[]) => [
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
    const sandboxes = new FakeSandboxRuntime()
    const service = new AgentExecutionSessionService(skills, sandboxes)
    const first = await service.activateSkill('run-1', 'user-1', 'isolated-skill')
    const second = await service.activateSkill('run-2', 'user-1', 'isolated-skill')

    expect(first.sandboxId).not.toBe(second.sandboxId)
    await service.writeFile(
      'run-1',
      'user-1',
      '/workspace/work/private.txt',
      new TextEncoder().encode('run-1-only'),
    )
    await expect(
      service.readFile('run-2', 'user-1', '/workspace/work/private.txt'),
    ).resolves.toBeNull()
    await expect(
      service.readFile('run-1', 'user-2', '/workspace/work/private.txt'),
    ).rejects.toThrow('owner mismatch')
    await service.destroyRun('run-1')
    await service.destroyRun('run-2')
  })
})
