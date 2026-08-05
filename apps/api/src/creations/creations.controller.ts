import { Controller, Get, Inject, Param, ParseUUIDPipe, Res, UseGuards } from '@nestjs/common'
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger'

import { CurrentUser } from '../user-auth/current-user.decorator'
import { USER_SESSION_COOKIE } from '../user-auth/user-auth.constants'
import { UserSessionGuard } from '../user-auth/user-session.guard'
import type { AuthenticatedUser } from '../user/user.types'
import type { Response } from 'express'
import { CreationsService } from './creations.service'

@ApiTags('Creations')
@ApiCookieAuth(USER_SESSION_COOKIE)
@UseGuards(UserSessionGuard)
@Controller('creations')
export class CreationsController {
  constructor(@Inject(CreationsService) private readonly creations: CreationsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.creations.list(user)
  }

  @Get('assets/:assetId/content')
  async downloadAsset(
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() response: Response,
  ): Promise<void> {
    const { asset, stored } = await this.creations.loadAsset(user, assetId)
    response.status(200)
    response.set({
      'content-type': asset.mimeType,
      'content-length': String(stored.bytes.byteLength),
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    })
    response.send(Buffer.from(stored.bytes))
  }
}
