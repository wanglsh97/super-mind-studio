import { Controller, Get, Inject, Param, ParseUUIDPipe, Req, Res, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../user-auth/current-user.decorator';
import { USER_SESSION_COOKIE } from '../user-auth/user-auth.constants';
import { UserSessionGuard } from '../user-auth/user-session.guard';
import type { AuthenticatedUser } from '../user/user.types';
import type { Request, Response } from 'express';
import { CreationsService } from './creations.service';

@ApiTags('Creations')
@ApiCookieAuth(USER_SESSION_COOKIE)
@UseGuards(UserSessionGuard)
@Controller('creations')
export class CreationsController {
  constructor(@Inject(CreationsService) private readonly creations: CreationsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.creations.list(user);
  }

  @Get('assets/:assetId/content')
  async downloadAsset(
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() response: Response,
  ): Promise<void> {
    const { asset, stored } = await this.creations.loadAsset(user, assetId);
    response.status(200);
    response.set({
      'content-type': asset.mimeType,
      'content-length': String(stored.bytes.byteLength),
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    });
    response.send(Buffer.from(stored.bytes));
  }

  @Get('assets/:assetId/preview')
  async previewAsset(
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const { asset, stored } = await this.creations.loadAsset(user, assetId);
    if (asset.mimeType === 'video/mp4') {
      sendVideoRange(request, response, Buffer.from(stored.bytes), asset.name, 'inline');
      return;
    }
    response.status(200);
    response.set({
      'content-type': asset.mimeType,
      'content-length': String(stored.bytes.byteLength),
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(asset.name)}`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    });
    response.send(Buffer.from(stored.bytes));
  }
}

function sendVideoRange(
  request: Request,
  response: Response,
  bytes: Buffer,
  name: string,
  disposition: 'inline' | 'attachment',
) {
  const headers = {
    'accept-ranges': 'bytes',
    'content-type': 'video/mp4',
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    'content-disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(name)}`,
  };
  const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '');
  if (!request.headers.range) {
    response.status(200).set({ ...headers, 'content-length': String(bytes.length) }).send(bytes);
    return;
  }
  if (!match) {
    response.status(416).set('content-range', `bytes */${bytes.length}`).end();
    return;
  }
  const start = match[1] ? Number(match[1]) : 0;
  const end = Math.min(match[2] ? Number(match[2]) : bytes.length - 1, bytes.length - 1);
  if (start > end || start >= bytes.length) {
    response.status(416).set('content-range', `bytes */${bytes.length}`).end();
    return;
  }
  response
    .status(206)
    .set({
      ...headers,
      'content-range': `bytes ${start}-${end}/${bytes.length}`,
      'content-length': String(end - start + 1),
    })
    .send(bytes.subarray(start, end + 1));
}
