import type { AgentExecutionSessionService } from '../sandbox/agent-execution-session.service'
import { renderActiveSkillPrompt } from '../skills/active-skill-prompt'
import type { AgentToolDefinition } from './agent-tool'
import { createToolErrorResult, requireRunScope } from './run-scoped-tool.helpers'

const ACTIVATE_SKILL_PARAMETERS = {
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
} as const

export function createSkillActivationTool(
  sessions: AgentExecutionSessionService,
): AgentToolDefinition<{ name: string }> {
  return {
    name: 'activate_skill',
    description:
      'Activate one Skill already added by the current user. Loads its current reviewed instructions and package into the current Thread sandbox.',
    label: '激活 Skill',
    riskLevel: 'read',
    approvalPolicy: 'none',
    parameters: ACTIVATE_SKILL_PARAMETERS,
    async execute(args, context) {
      const scope = requireRunScope(context)
      try {
        const result = await sessions.activateSkill(
          scope.runId,
          scope.userId,
          args.name,
          context.signal,
        )
        return {
          content: renderActiveSkillPrompt({
            name: result.skill.manifest.name,
            packageSha256: result.skill.manifest.packageSha256,
            skillMarkdown: result.skill.skillMarkdown,
          }),
          summary: result.alreadyActive ? `Skill ${args.name} 已激活` : `已激活 Skill ${args.name}`,
          isError: false,
          audit: {
            sandboxId: result.sandboxId,
            skillId: result.skill.manifest.skillId,
            skillName: result.skill.manifest.name,
            packageSha256: result.skill.manifest.packageSha256,
            alreadyActive: result.alreadyActive,
          },
        }
      } catch (error) {
        return createToolErrorResult(error, `Skill ${args.name} 激活失败`)
      }
    },
  }
}
