import type { AgentExecutionSessionService } from '../sandbox/agent-execution-session.service'
import type { AgentToolDefinition } from './agent-tool'
import { createToolErrorResult, requireRunScope } from './run-scoped-tool.helpers'

const WRITE_FILE_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  required: ['path', 'content'],
  properties: {
    path: {
      type: 'string',
      minLength: 1,
      maxLength: 1_024,
      description:
        'A path inside /workspace. Both /workspace/work/file.txt and work/file.txt are accepted.',
    },
    content: { type: 'string', maxLength: 1_048_576 },
  },
} as const

export function createWriteFileTool(
  sessions: AgentExecutionSessionService,
): AgentToolDefinition<{ path: string; content: string }> {
  return {
    name: 'write_file',
    description:
      'Write UTF-8 text to one file in the current Thread sandbox workspace. Paths may be absolute under /workspace or relative to /workspace.',
    label: '写入文件',
    riskLevel: 'write',
    approvalPolicy: 'none',
    parameters: WRITE_FILE_PARAMETERS,
    async execute(args, context) {
      const scope = requireRunScope(context)
      try {
        const file = await sessions.writeFile(
          scope.runId,
          scope.userId,
          args.path,
          new TextEncoder().encode(args.content),
          context.signal,
        )
        return {
          content: `Wrote ${file.sizeBytes} bytes to ${file.path}`,
          summary: `已写入 ${args.path}`,
          isError: false,
          audit: { path: file.path, size: file.sizeBytes, sha256: file.sha256 },
        }
      } catch (error) {
        return createToolErrorResult(error, '写入文件失败')
      }
    },
  }
}
