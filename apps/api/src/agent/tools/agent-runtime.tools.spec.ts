import { AgentExecutionSessionService } from '../sandbox/agent-execution-session.service'
import { createOpenSandboxRuntimeTestDouble } from '../sandbox/open-sandbox-runtime.test'
import type { AgentThreadRepository } from '../agent-thread.repository'
import type { ExecutableSkillService } from '../skills/executable-skill.service'
import type { ConfigService } from '@nestjs/config'
import type { AgentOutputFileService } from '../files/agent-output-file.service'
import {
  MOCK_EXECUTABLE_SKILL_DOWNLOAD,
  MOCK_EXECUTABLE_SKILL_SHA256,
} from '../skills/executable-skill.fixture'
import { AgentToolRegistry } from './agent-tool.registry'
import { createExportFileTool } from './export-file.tool'
import { createReadFileTool } from './read-file.tool'
import { createShellTool } from './shell.tool'
import { createActivateSkillTool } from './activate-skill.tool'
import { createWriteFileTool } from './write-file.tool'

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
  const sandbox = createOpenSandboxRuntimeTestDouble()
  const threads = {
    findSandboxForOwner: jest.fn().mockResolvedValue(null),
    markSandboxReady: jest.fn().mockResolvedValue(undefined),
    markSandboxIdle: jest.fn().mockResolvedValue(undefined),
    clearSandbox: jest.fn().mockResolvedValue(undefined),
    listOwnedSandboxes: jest.fn().mockResolvedValue([]),
  } as unknown as AgentThreadRepository
  const config = {
    get: jest.fn((_key: string, fallback: number) => fallback),
  } as unknown as ConfigService
  const sessions = new AgentExecutionSessionService(skills, sandbox, threads, config)
  const outputs = {
    export: jest.fn(async (_runId: string, _userId: string, path: string) => ({
      id: '00000000-0000-4000-8000-000000000001',
      name: 'result.txt',
      mimeType: 'text/plain',
      sizeBytes: 6,
      sha256: 'a'.repeat(64),
      path,
      contentUrl: '/api/v1/agent/files/00000000-0000-4000-8000-000000000001/content',
      downloadUrl: '/api/v1/agent/files/00000000-0000-4000-8000-000000000001/content?download=1',
    })),
  } as unknown as AgentOutputFileService
  const registry = new AgentToolRegistry([
    createActivateSkillTool(sessions),
    createShellTool(sessions),
    createReadFileTool(sessions),
    createWriteFileTool(sessions),
    createExportFileTool(outputs),
  ])
  const context = {
    runId: 'run-1',
    userId: 'user-1',
    toolCallId: 'tool-1',
    signal: new AbortController().signal,
  }
  return { context, registry, sandbox, sessions, skills, outputs }
}

describe('Agent runtime tools', () => {
  it('keeps Skill activation and general Sandbox tools at the same registry level', async () => {
    const { context, registry, sessions, skills } = setup()
    await sessions.startRun(context.runId, 'thread-1', context.userId)

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
      'export_file',
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
    await expect(
      registry.execute(
        'export_file',
        { path: '/workspace/output/result.txt' },
        { ...context, toolCallId: 'tool-export' },
      ),
    ).resolves.toMatchObject({
      isError: false,
      summary: '已导出产物 result.txt',
      audit: {
        fileId: '00000000-0000-4000-8000-000000000001',
        mimeType: 'text/plain',
        size: 6,
      },
    })

    await sessions.finishRun('run-1')
    await expect(
      registry.execute('shell', { command: 'echo no' }, { ...context, toolCallId: 'tool-6' }),
    ).resolves.toMatchObject({ isError: true, audit: { code: 'SANDBOX_UNAVAILABLE' } })
  })

  it('normalizes authorization failures and validates schemas before execution', async () => {
    const { context, registry, skills, sessions } = setup()
    await sessions.startRun(context.runId, 'thread-1', context.userId)

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
    const { context, registry, sessions } = setup()
    await sessions.startRun(context.runId, 'thread-1', context.userId)
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
