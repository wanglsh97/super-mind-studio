import {
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser } from '../../user-auth/current-user.decorator';
import { UserSessionGuard } from '../../user-auth/user-session.guard';
import type { AuthenticatedUser } from '../../user/user.types';
import { VideoInputService } from './video-input.service';

@Controller('agent/video-inputs')
export class VideoInputController {
  constructor(@Inject(VideoInputService) private readonly inputs: VideoInputService) {}
  @UseGuards(UserSessionGuard)
  @Post('threads/:threadId')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10_000_000, files: 1 } }))
  upload(
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @UploadedFile() file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inputs.upload(user.id, threadId, file);
  }
  @UseGuards(UserSessionGuard)
  @Delete('threads/:threadId/assets/:assetId')
  async remove(
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() response: Response,
  ) {
    await this.inputs.removeUnsubmitted(user.id, threadId, assetId);
    response.status(204).send();
  }
  @UseGuards(UserSessionGuard)
  @Get('threads/:threadId/assets/:assetId/content')
  async ownedContent(
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() response: Response,
  ) {
    const { asset, file } = await this.inputs.readOwned(user.id, threadId, assetId);
    response
      .status(200)
      .set({
        'content-type': asset.mimeType,
        'content-length': String(file.sizeBytes),
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      })
      .send(Buffer.from(file.bytes));
  }
  @Get(':token/content') async content(@Param('token') token: string, @Res() response: Response) {
    const { asset, file } = await this.inputs.readSigned(token);
    response
      .status(200)
      .set({
        'content-type': asset.mimeType,
        'content-length': String(file.sizeBytes),
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      })
      .send(Buffer.from(file.bytes));
  }
}
