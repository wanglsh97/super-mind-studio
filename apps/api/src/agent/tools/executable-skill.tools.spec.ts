import { AgentExecutionSessionService } from '../sandbox/agent-execution-session.service'
import { FakeSandboxRuntime } from '../sandbox/fake-sandbox-runtime'
import type { ExecutableSkillService } from '../skills/executable-skill.service'
import {
  MOCK_EXECUTABLE_SKILL_DOWNLOAD,
  MOCK_EXECUTABLE_SKILL_SHA256,
} from '../skills/executable-skill.fixture'
import { AgentToolRegistry } from './agent-tool.registry'
import { createExecutableSkillTools } from './executable-skill.tools'

const preparedSkill = {
  manifest: {
    skillId: 'skill-1',
    name: 'mock-data-cleaner',
    packageSha256: MOCK_EXECUTABLE_SKILL_SHA256,
  },
  download: MOCK_EXECUTABLE_SKILL_DOWNLOAD,
}

function setup() {
  const skills = {
    prepareActivation: jest.fn(async (_userId: string, names: readonly string[]) => {
      if (names[0] !== 'mock-data-cleaner' && names[0] !== 'second-skill') {
        throw Object.assign(new Error('Skill 未添加'), {
          code: 'SKILL_NOT_ADDED',
          retryable: false,
        })
      }
      return [
        names[0] === 'mock-data-cleaner'
          ? preparedSkill
          : {
              ...preparedSkill,
              manifest: {
                ...preparedSkill.manifest,
                skillId: 'skill-2',
                name: 'second-skill',
              },
            },
      ]
    }),
  } as unknown as ExecutableSkillService
  const sandbox = new FakeSandboxRuntime({
    commands: [{ command: 'node scripts/clean.mjs', stdout: 'cleaned\n', durationMs: 12 }],
  })
  const sessions = new AgentExecutionSessionService(skills, sandbox)
  const registry = new AgentToolRegistry(createExecutableSkillTools(sessions))
  const context = {
    runId: 'run-1',
    userId: 'user-1',
    toolCallId: 'tool-1',
    signal: new AbortController().signal,
  }
  return { context, registry, sandbox, sessions, skills }
}

describe('executable Skill tools', () => {
  it('routes activation, Shell and file calls through one Run sandbox with auditable results', async () => {
    const { context, registry, sessions, skills } = setup()

    expect(registry.get('activate_skill').parameters).toEqual({
      type: 'object',
      additionalProperties: false,
      required: ['name'],
      properties: {
        name: {
          type: 'string',
          minLength: 1,
          maxLength: 64,
          pattern: '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$',
        },
      },
    })

    const activation = await registry.execute(
      'activate_skill',
      { name: 'mock-data-cleaner' },
      context,
    )
    expect(activation).toMatchObject({
      isError: false,
      audit: {
        skillId: 'skill-1',
        skillName: 'mock-data-cleaner',
        packageSha256: MOCK_EXECUTABLE_SKILL_SHA256,
        alreadyActive: false,
      },
    })
    expect(activation.content).toContain('# Mock Data Cleaner')
    expect(activation.content).toContain('<active_skill name="mock-data-cleaner"')
    expect(activation.content).toContain(`package_sha256="${MOCK_EXECUTABLE_SKILL_SHA256}"`)
    expect(activation.content).toContain('registered tool permissions, or hard resource budgets')
    expect(registry.list().map((tool) => tool.name)).toEqual([
      'activate_skill',
      'shell',
      'read_file',
      'write_file',
    ])

    const duplicate = await registry.execute(
      'activate_skill',
      { name: 'mock-data-cleaner' },
      { ...context, toolCallId: 'tool-2' },
    )
    expect(duplicate.audit).toMatchObject({
      sandboxId: activation.audit?.sandboxId,
      alreadyActive: true,
    })
    expect(skills.prepareActivation).toHaveBeenCalledTimes(1)

    const second = await registry.execute(
      'activate_skill',
      { name: 'second-skill' },
      { ...context, toolCallId: 'tool-second-skill' },
    )
    expect(second).toMatchObject({
      isError: false,
      audit: {
        sandboxId: activation.audit?.sandboxId,
        skillId: 'skill-2',
        skillName: 'second-skill',
        alreadyActive: false,
      },
    })
    expect(skills.prepareActivation).toHaveBeenCalledTimes(2)

    const shell = await registry.execute(
      'shell',
      {
        command: 'node scripts/clean.mjs',
        workingDirectory: '/workspace/skills/mock-data-cleaner',
      },
      { ...context, toolCallId: 'tool-3' },
    )
    expect(shell).toMatchObject({
      isError: false,
      content: 'cleaned\n',
      audit: { command: 'node scripts/clean.mjs', exitCode: 0, durationMs: 12 },
    })

    await expect(
      registry.execute(
        'write_file',
        { path: '/workspace/output/result.txt', content: 'result' },
        { ...context, toolCallId: 'tool-4' },
      ),
    ).resolves.toMatchObject({ isError: false, audit: { size: 6 } })
    await expect(
      registry.execute(
        'read_file',
        { path: '/workspace/output/result.txt' },
        { ...context, toolCallId: 'tool-5' },
      ),
    ).resolves.toMatchObject({ isError: false, content: 'result', audit: { size: 6 } })

    await sessions.destroyRun('run-1')
    await expect(
      registry.execute('shell', { command: 'echo no' }, { ...context, toolCallId: 'tool-6' }),
    ).resolves.toMatchObject({ isError: true, audit: { code: 'SANDBOX_UNAVAILABLE' } })
  })

  it('normalizes authorization failures and validates schemas before execution', async () => {
    const { context, registry, skills } = setup()

    await expect(
      registry.execute('activate_skill', { name: 'not-added' }, context),
    ).resolves.toMatchObject({
      isError: true,
      audit: { code: 'SKILL_NOT_ADDED', retryable: false },
    })
    await expect(
      registry.execute('activate_skill', { name: '', extra: true }, context),
    ).resolves.toMatchObject({
      isError: true,
      audit: { code: 'AGENT_TOOL_INVALID_ARGS' },
    })
    expect(skills.prepareActivation).toHaveBeenCalledTimes(1)
  })

  it('requires a bound Run/user scope and prevents cross-user session reuse', async () => {
    const { context, registry } = setup()
    await registry.execute('activate_skill', { name: 'mock-data-cleaner' }, context)

    await expect(
      registry.execute(
        'shell',
        { command: 'echo no' },
        { ...context, userId: 'user-2', toolCallId: 'tool-cross-user' },
      ),
    ).resolves.toMatchObject({ isError: true, audit: { code: 'SANDBOX_UNAVAILABLE' } })
    await expect(
      registry.execute(
        'shell',
        { command: 'echo no' },
        {
          toolCallId: 'tool-no-scope',
          signal: context.signal,
        },
      ),
    ).rejects.toThrow('Run-scoped tool context is missing')
  })
})
