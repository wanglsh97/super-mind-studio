import type { AgentOutputFileService } from '../files/agent-output-file.service'
import type { AgentToolDefinition } from './agent-tool'
import { createToolErrorResult, requireRunScope } from './run-scoped-tool.helpers'

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

export function createExportFileTool(
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
