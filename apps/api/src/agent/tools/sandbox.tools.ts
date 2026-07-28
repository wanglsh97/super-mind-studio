import type { AgentExecutionSessionService } from '../sandbox/agent-execution-session.service'
import type { AgentOutputFileService } from '../files/agent-output-file.service'
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

const EXPORT_FILE_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: {
    path: {
      type: 'string',
      minLength: 1,
      maxLength: 1_024,
      description:
        'A file path under /workspace/output. Absolute, output/file.svg, and file.svg forms are accepted.',
    },
  },
} as const

export function createSandboxTools(
  sessions: AgentExecutionSessionService,
  outputs: AgentOutputFileService,
): readonly AgentToolDefinition[] {
  return [
    createShellTool(sessions),
    createReadFileTool(sessions),
    createWriteFileTool(sessions),
    createExportFileTool(outputs),
  ]
}

function createShellTool(
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
        return {
          content: content || `(exit ${result.exitCode ?? 'terminated'})`,
          summary:
            result.exitCode === 0 && !result.error
              ? `命令执行完成（exit 0）`
              : `命令执行失败（${result.error?.message ?? `exit ${result.exitCode}`})`,
          isError: result.exitCode !== 0 || result.error !== undefined,
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
            ...(result.error === undefined ? {} : { code: result.error.code }),
          },
        }
      } catch (error) {
        return createToolErrorResult(error, 'Shell 执行失败')
      }
    },
  }
}

function createReadFileTool(
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
            { code: 'FILE_NOT_FOUND', message: '文件不存在' },
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

function createWriteFileTool(
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

function createExportFileTool(
  outputs: AgentOutputFileService,
): AgentToolDefinition<{ path: string }> {
  return {
    name: 'export_file',
    description:
      'Persist one completed user-facing artifact from /workspace/output to private storage. Call this for every file the user should be able to preview or download.',
    label: '导出产物',
    riskLevel: 'write',
    approvalPolicy: 'none',
    parameters: EXPORT_FILE_PARAMETERS,
    async execute(args, context) {
      const scope = requireRunScope(context)
      try {
        const file = await outputs.export(scope.runId, scope.userId, args.path, context.signal)
        return {
          content: `Exported ${file.name} (${file.sizeBytes} bytes). The artifact is now available to the user.`,
          summary: `已导出产物 ${file.name}`,
          isError: false,
          audit: {
            fileId: file.id,
            name: file.name,
            mimeType: file.mimeType,
            size: file.sizeBytes,
            sha256: file.sha256,
            path: file.path,
            contentUrl: file.contentUrl,
            downloadUrl: file.downloadUrl,
          },
        }
      } catch (error) {
        return createToolErrorResult(error, '导出产物失败')
      }
    },
  }
}
