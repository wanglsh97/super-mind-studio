import type { WebsiteDeliveryService } from '../website/website-delivery.service'
import type { AgentToolDefinition } from './agent-tool'
import { createToolErrorResult, requireRunScope } from './run-scoped-tool.helpers'

export function createWebsiteTool(
  delivery: WebsiteDeliveryService,
): AgentToolDefinition<Record<string, never>> {
  return {
    name: 'create_website',
    description:
      'Build, validate, archive and expose the current static website. This is the only successful website delivery action. Fix every returned error and retry before completing the task.',
    label: '创建网站',
    riskLevel: 'write',
    approvalPolicy: 'none',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    async execute(_args, context) {
      const scope = requireRunScope(context)
      try {
        context.onProgress?.('正在构建并校验静态网站')
        const result = await delivery.deliver(scope.runId, scope.userId, context.signal)
        return {
          content:
            'Website delivery succeeded. The current preview and both final ZIP downloads are ready. These artifacts replace the previous successful delivery for this Thread.',
          summary: '网站已构建并交付',
          isError: false,
          audit: {
            projectId: result.projectId,
            creationId: result.creationId,
            runId: result.runId,
            builtAt: result.builtAt,
            expiresAt: result.expiresAt,
            previewPath: result.previewPath,
            sourceId: result.source.id,
            sourceName: result.source.name,
            sourceDownloadUrl: result.source.downloadUrl,
            sourceSizeBytes: result.source.sizeBytes,
            distId: result.dist.id,
            distName: result.dist.name,
            distDownloadUrl: result.dist.downloadUrl,
            distSizeBytes: result.dist.sizeBytes,
          },
        }
      } catch (error) {
        return createToolErrorResult(error, '网站交付失败，需要修复后重试')
      }
    },
  }
}
