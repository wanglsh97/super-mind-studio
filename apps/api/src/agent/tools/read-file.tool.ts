import type { AgentExecutionSessionService } from '../sandbox/agent-execution-session.service'
import type { AgentToolDefinition } from './agent-tool'
import { createToolErrorResult, requireRunScope } from './run-scoped-tool.helpers'

const READ_FILE_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: {
    path: {
      type: 'string',
      minLength: 1,
      maxLength: 1_024,
      description:
        'A path inside /workspace. Both /workspace/output/file.svg and output/file.svg are accepted.',
    },
  },
} as const

export function createReadFileTool(
  sessions: AgentExecutionSessionService,
): AgentToolDefinition<{ path: string }> {
  return {
    name: 'read_file',
    description:
      'Read one UTF-8 text file from the current Thread sandbox workspace. Paths may be absolute under /workspace or relative to /workspace.',
    label: '读取文件',
    riskLevel: 'read',
    approvalPolicy: 'none',
    parameters: READ_FILE_PARAMETERS,
    async execute(args, context) {
      const scope = requireRunScope(context)
      try {
        const file = await sessions.readFile(scope.runId, scope.userId, args.path, context.signal)
        if (!file)
          return createToolErrorResult(
            {
              code: 'FILE_NOT_FOUND',
              message: `文件 ${args.path} 不存在。请先使用 shell 检查目录内容，再使用实际存在的路径重试。`,
              retryable: true,
            },
            '读取文件失败',
          )
        return {
          content: new TextDecoder().decode(file.bytes),
          summary: `已读取 ${args.path}`,
          isError: false,
          audit: { path: file.path, size: file.sizeBytes, sha256: file.sha256 },
        }
      } catch (error) {
        return createToolErrorResult(error, '读取文件失败')
      }
    },
  }
}
