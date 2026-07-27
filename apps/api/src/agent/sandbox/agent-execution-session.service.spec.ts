import type { ExecutableSkillService } from '../skills/executable-skill.service'
import { AgentExecutionSessionService } from './agent-execution-session.service'
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
})
