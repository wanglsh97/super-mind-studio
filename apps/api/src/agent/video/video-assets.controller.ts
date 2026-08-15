import {
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../user-auth/current-user.decorator';
import { UserSessionGuard } from '../../user-auth/user-session.guard';
import type { AuthenticatedUser } from '../../user/user.types';
import { VideoGenerationService } from './video-generation.service';
import { VideoAssetService } from './video-asset.service';
@UseGuards(UserSessionGuard)
@Controller('agent/videos')
export class VideoAssetsController {
  constructor(
    @Inject(VideoGenerationService) private readonly videos: VideoGenerationService,
    @Inject(VideoAssetService) private readonly assets: VideoAssetService,
  ) {}
  @Get(':videoId/content') async content(
    @Param('videoId', ParseUUIDPipe) id: string,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const { file } = await this.videos.readOwned(u.id, id);
    sendRange(req, res, Buffer.from(file.bytes), 'inline');
  }
  @Post(':videoId/save') save(
    @Param('videoId', ParseUUIDPipe) id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    return this.assets.save(u.id, id);
  }
  @Get(':videoId/download') async download(
    @Param('videoId', ParseUUIDPipe) id: string,
    @CurrentUser() u: AuthenticatedUser,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const saved = await this.assets.save(u.id, id);
    if (!saved.assetId) throw new Error('视频资产缺失');
    const { stored } = await this.assets.load(u.id, saved.assetId);
    sendRange(req, res, Buffer.from(stored.bytes), 'attachment');
  }
  @Delete('creations/:creationId') async remove(
    @Param('creationId', ParseUUIDPipe) id: string,
    @CurrentUser() u: AuthenticatedUser,
  ) {
    await this.assets.remove(u.id, id);
    return { deleted: true };
  }
}
function sendRange(
  req: Request,
  res: Response,
  bytes: Buffer,
  disposition: 'inline' | 'attachment',
) {
  const range = req.headers.range;
  const base = {
    'accept-ranges': 'bytes',
    'content-type': 'video/mp4',
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
    'content-disposition': `${disposition}; filename="generated-video.mp4"`,
  };
  if (!range) {
    res
      .status(200)
      .set({ ...base, 'content-length': String(bytes.length) })
      .send(bytes);
    return;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    res.status(416).set('content-range', `bytes */${bytes.length}`).end();
    return;
  }
  const start = match[1] ? Number(match[1]) : 0,
    end = Math.min(match[2] ? Number(match[2]) : bytes.length - 1, bytes.length - 1);
  if (start > end || start >= bytes.length) {
    res.status(416).set('content-range', `bytes */${bytes.length}`).end();
    return;
  }
  res
    .status(206)
    .set({
      ...base,
      'content-range': `bytes ${start}-${end}/${bytes.length}`,
      'content-length': String(end - start + 1),
    })
    .send(bytes.subarray(start, end + 1));
}
