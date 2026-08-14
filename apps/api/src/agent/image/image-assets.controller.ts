import {
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { CurrentUser } from '../../user-auth/current-user.decorator';
import { USER_SESSION_COOKIE } from '../../user-auth/user-auth.constants';
import { UserSessionGuard } from '../../user-auth/user-session.guard';
import type { AuthenticatedUser } from '../../user/user.types';
import { ImageAssetService } from './image-asset.service';
import { BailianAsyncImageTransport } from './bailian-image.transport';
import { ImageGenerationService } from './image-generation.service';
import { ImageModelCatalog } from './image-model.catalog';

@ApiTags('Agent images')
@ApiCookieAuth(USER_SESSION_COOKIE)
@UseGuards(UserSessionGuard)
@Controller('agent/images')
export class ImageAssetsController {
  constructor(
    @Inject(ImageGenerationService) private readonly images: ImageGenerationService,
    @Inject(ImageAssetService) private readonly assets: ImageAssetService,
    @Inject(ImageModelCatalog) private readonly catalog: ImageModelCatalog,
    @Inject(BailianAsyncImageTransport) private readonly transport: BailianAsyncImageTransport,
  ) {}

  @Get('models')
  models() {
    return {
      enabled: this.transport.isConfigured(),
      models: this.catalog.capabilities(),
    };
  }

  @Get(':imageId/content')
  async preview(
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() response: Response,
  ): Promise<void> {
    await this.sendTemporary(user.id, imageId, response, false);
  }

  @Get(':imageId/download')
  async download(
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() response: Response,
  ): Promise<void> {
    await this.sendTemporary(user.id, imageId, response, true);
  }

  @Post(':imageId/save')
  save(@Param('imageId', ParseUUIDPipe) imageId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.assets.save(user.id, imageId);
  }

  private async sendTemporary(
    userId: string,
    imageId: string,
    response: Response,
    attachment: boolean,
  ): Promise<void> {
    const { task, file } = await this.images.readOwnedImage(userId, imageId);
    response
      .status(200)
      .set({
        'content-type': task.mimeType!,
        'content-length': String(file.bytes.byteLength),
        'content-disposition': `${attachment ? 'attachment' : 'inline'}; filename="generated-image.${extension(task.mimeType!)}"`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      })
      .send(Buffer.from(file.bytes));
  }
}

function extension(mimeType: string): string {
  return mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
}
