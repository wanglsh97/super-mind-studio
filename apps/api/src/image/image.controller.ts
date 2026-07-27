import { randomUUID } from 'node:crypto'

import type { ImageTask } from '@supermind/sdk'
import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common'
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger'
import type { Request, Response } from 'express'

import { RateLimitService } from '../rate-limit/rate-limit.service'
import { CurrentUser } from '../user-auth/current-user.decorator'
import { USER_SESSION_COOKIE } from '../user-auth/user-auth.constants'
import type { AuthenticatedUser } from '../user-auth/user-session.service'
import { UserSessionGuard } from '../user-auth/user-session.guard'
import type { ImageAdapter } from './adapters/image-adapter'
import { ImageAdapterRegistry } from './adapters/image-adapter.registry'
import { CreateImageGenerationDto } from './dto/create-image-generation.dto'
import { ImageService } from './image.service'

type RequestWithId = Request & { id?: string }

@ApiTags('Images')
@ApiCookieAuth(USER_SESSION_COOKIE)
@Controller('images/generations')
export class ImageController {
  constructor(
    @Inject(ImageAdapterRegistry) private readonly adapters: ImageAdapterRegistry,
    @Inject(ImageService) private readonly images: ImageService,
    @Inject(RateLimitService) private readonly rateLimit: RateLimitService,
  ) {}

  @Post()
  @UseGuards(UserSessionGuard)
  async create(
    @Body() input: CreateImageGenerationDto,
    @Req() request: RequestWithId,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ImageTask> {
    await this.rateLimit.consumeImage(request.ip)
    const requestId = request.id ?? randomUUID()
    const adapter = this.resolveAdapter(input.model)
    const task = await this.images.createPending(user.id, requestId, input, adapter, request.ip)
    const abortController = new AbortController()
    const abort = () => abortController.abort()
    request.once('aborted', abort)
    const submission = await adapter
      .submit({
        requestId,
        modelAlias: input.model,
        resolvedModel: adapter.resolvedModel,
        prompt: input.prompt,
        signal: abortController.signal,
        ...(input.size === undefined ? {} : { size: input.size }),
        ...(input.count === undefined ? {} : { count: input.count }),
      })
      .finally(() => request.removeListener('aborted', abort))
    const updated = await this.images.recordSubmission(task.taskId, user.id, submission)
    return this.images.toPublicTask(updated)
  }

  @Get(':taskId')
  @UseGuards(UserSessionGuard)
  async get(
    @Param('taskId') taskId: string,
    @Req() request: RequestWithId,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ImageTask> {
    const abortController = new AbortController()
    const abort = () => abortController.abort()
    request.once('aborted', abort)
    return this.images
      .get(taskId, user.id, abortController.signal)
      .finally(() => request.removeListener('aborted', abort))
  }

  @Get(':taskId/images/:index/download')
  @UseGuards(UserSessionGuard)
  async download(
    @Param('taskId') taskId: string,
    @Param('index', ParseIntPipe) index: number,
    @Req() request: RequestWithId,
    @Res() response: Response,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    const abortController = new AbortController()
    const abort = () => abortController.abort()
    request.once('aborted', abort)
    const image = await this.images
      .download(taskId, user.id, index, abortController.signal)
      .finally(() => request.removeListener('aborted', abort))
    const extension = image.contentType === 'image/jpeg' ? 'jpg' : image.contentType.split('/')[1]
    response.set({
      'content-type': image.contentType,
      'content-length': String(image.body.byteLength),
      'content-disposition': `attachment; filename="super-mind-${taskId}-${index}.${extension}"`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, max-age=300',
    })
    response.send(Buffer.from(image.body))
  }

  private resolveAdapter(alias: CreateImageGenerationDto['model']): ImageAdapter {
    if (this.adapters.has(alias)) return this.adapters.get(alias)
    if (this.adapters.has('mock')) return this.adapters.get('mock')
    throw new ServiceUnavailableException('当前没有可用的图片模型')
  }
}
