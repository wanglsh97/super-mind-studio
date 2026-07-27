import type { ExecutableSkillService } from '../skills/executable-skill.service'
import { AgentExecutionSessionService } from './agent-execution-session.service'
import { FakeSandboxRuntime } from './fake-sandbox-runtime'
import type { SandboxRuntimePort } from './sandbox-runtime.port'

describe('AgentExecutionSessionService sandbox cleanup', () => {
  it('destroys a partially created sandbox when readiness fails', async () => {
    const readyError = new Error('ready timeout')
    const destroySandbox = jest.fn().mockRejectedValue(new Error('temporary network failure'))
    const sandboxes = {
      createSandbox: jest.fn().mockResolvedValue({ sandboxId: 'sandbox-partial' }),
      waitUntilReady: jest.fn().mockRejectedValue(readyError),
      destroySandbox,
    } as unknown as SandboxRuntimePort
    const skills = {
      activateManually: jest.fn().mockResolvedValue([
        {
          name: 'test-skill',
          archive: new Uint8Array(),
          skillMarkdown: '# Test',
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
      activateManually: jest.fn(async (_userId: string, selected: readonly string[]) => [
        {
          manifest: {
            skillId: `id-${selected[0]}`,
            name: selected[0],
            packageSha256: 'a'.repeat(64),
          },
          archive: new Uint8Array(),
          skillMarkdown: `# ${selected[0]}`,
          files: [],
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
    expect(skills.activateManually).toHaveBeenCalledTimes(50)
    await service.destroyRun('run-many')
  })
})
