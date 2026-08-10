import type { AgentExecutionSessionService } from '../sandbox/agent-execution-session.service'
import type { AgentToolDefinition } from './agent-tool'
import { createToolErrorResult, requireRunScope } from './run-scoped-tool.helpers'

const SHELL_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  required: ['command'],
  properties: {
    command: { type: 'string', minLength: 1, maxLength: 8_000 },
    workingDirectory: { type: 'string', minLength: 1, maxLength: 1_024 },
  },
} as const

export function createShellTool(
  sessions: AgentExecutionSessionService,
): AgentToolDefinition<{ command: string; workingDirectory?: string }> {
  return {
    name: 'shell',
    description:
      'Run one command autonomously in the current Thread Linux sandbox. Commands are constrained by fixed time, resource, traffic and output budgets.',
    label: 'Shell',
    riskLevel: 'destructive',
    approvalPolicy: 'none',
    parameters: SHELL_PARAMETERS,
    async execute(args, context) {
      const scope = requireRunScope(context)
      try {
        const result = await sessions.runShell(scope.runId, scope.userId, {
          command: args.command,
          workingDirectory: args.workingDirectory ?? '/workspace/work',
          signal: context.signal,
        })
        const content = [result.stdout.content, result.stderr.content].filter(Boolean).join('\n')
        if (result.exitCode !== 0 || result.error !== undefined) {
          const reason = result.error?.message ?? `命令退出码为 ${result.exitCode ?? 'unknown'}`
          return createToolErrorResult(
            {
              code: result.error?.code ?? 'SHELL_EXIT_NONZERO',
              message: `${reason}。${content ? `命令输出：\n${content}\n` : ''}请根据输出修正命令、依赖或工作目录后重试。`,
              retryable: !context.signal.aborted,
            },
            'Shell 执行失败',
          )
        }
        return {
          content: content || `(exit ${result.exitCode ?? 'terminated'})`,
          summary: '命令执行完成（exit 0）',
          isError: false,
          audit: {
            command: args.command,
            workingDirectory: args.workingDirectory ?? '/workspace/work',
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            stdoutBytes: result.stdout.bytes,
            stderrBytes: result.stderr.bytes,
            stdoutTruncated: result.stdout.truncated,
            stderrTruncated: result.stderr.truncated,
            limitReason: result.limitReason,
          },
        }
      } catch (error) {
        return createToolErrorResult(error, 'Shell 执行失败')
      }
    },
  }
}
