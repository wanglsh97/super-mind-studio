import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Res, UseGuards } from '@nestjs/common'
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'

import { CurrentUser } from '../user-auth/current-user.decorator'
import { USER_SESSION_COOKIE } from '../user-auth/user-auth.constants'
import { UserSessionGuard } from '../user-auth/user-session.guard'
import type { AuthenticatedUser } from '../user/user.types'
import { CreateWebProjectDto } from './dto/create-web-project.dto'
import { CreationsService } from './creations.service'
import { WebProjectPreviewService } from './web-project-preview.service'

@ApiTags('Creations')
@ApiCookieAuth(USER_SESSION_COOKIE)
@UseGuards(UserSessionGuard)
@Controller('creations')
export class CreationsController {
  constructor(@Inject(CreationsService) private readonly creations: CreationsService, @Inject(WebProjectPreviewService) private readonly preview: WebProjectPreviewService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) { return this.creations.list(user) }

  @Post('websites')
  createWebsite(@CurrentUser() user: AuthenticatedUser, @Body() input: CreateWebProjectDto) {
    return this.creations.createWebsite(user, input)
  }

  @Get('websites/:projectId/assets/:kind')
  async downloadWebsiteAsset(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('kind') kind: string,
    @Res() response: Response,
  ): Promise<void> {
    const { record, stored } = await this.creations.downloadWebsiteAsset(user, projectId, kind)
    response.status(200)
    response.set({
      'content-type': record.mimeType ?? stored.metadata.contentType,
      'content-length': String(stored.bytes.byteLength),
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(record.name)}`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    })
    response.end(Buffer.from(stored.bytes))
  }

  @Get('websites/:projectId/preview')
  async previewIndex(@CurrentUser() user: AuthenticatedUser, @Param('projectId', ParseUUIDPipe) projectId: string, @Res() response: Response): Promise<void> {
    return this.writePreview(response, await this.preview.load(user, projectId))
  }

  @Get('websites/:projectId/preview/*assetPath')
  async previewAsset(@CurrentUser() user: AuthenticatedUser, @Param('projectId', ParseUUIDPipe) projectId: string, @Param('assetPath') assetPath: string, @Res() response: Response): Promise<void> {
    return this.writePreview(response, await this.preview.load(user, projectId, assetPath))
  }

  @Get('websites/:projectId')
  getWebsite(@CurrentUser() user: AuthenticatedUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.creations.getWebsite(user, projectId)
  }

  private writePreview(response: Response, content: { bytes: Uint8Array; contentType: string }): void {
    response.status(200).set({ 'content-type': content.contentType, 'content-length': String(content.bytes.byteLength), 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox allow-scripts; default-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:" }).end(Buffer.from(content.bytes))
  }
}
