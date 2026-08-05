import { Controller, Get, Inject, NotFoundException, Param, Res } from '@nestjs/common'
import type { Response } from 'express'

import { AgentService } from '../agent.service'
import { AgentPreviewTokenService } from './agent-preview-token.service'

const PREVIEW_CONTENT_SECURITY_POLICY = [
  "default-src 'self' data: blob: https:",
  "script-src 'self' 'unsafe-inline' https:",
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  'connect-src https:',
  "frame-ancestors 'self'",
  "base-uri 'none'",
  'sandbox allow-forms allow-modals allow-popups allow-scripts',
].join('; ')

@Controller('agent/preview')
export class AgentPreviewProxyController {
  constructor(
    @Inject(AgentService) private readonly agent: AgentService,
    @Inject(AgentPreviewTokenService) private readonly tokens: AgentPreviewTokenService,
  ) {}

  @Get(':token/*assetPath')
  async readPreviewAsset(
    @Param('token') token: string,
    @Param('assetPath') assetPath: string | string[],
    @Res() response: Response,
  ): Promise<void> {
    if (!assetPath || assetPath.length === 0) throw new NotFoundException('网站预览资源不存在')
    const claims = this.tokens.verify(token)
    const asset = await this.agent.readPreviewAsset(
      claims.userId,
      claims.runId,
      claims.port,
      assetPath,
    )

    response.status(asset.status)
    response.setHeader('Content-Type', asset.contentType)
    response.setHeader('Cache-Control', 'private, no-store')
    response.setHeader('Content-Security-Policy', PREVIEW_CONTENT_SECURITY_POLICY)
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    response.send(Buffer.from(asset.body))
  }
}
