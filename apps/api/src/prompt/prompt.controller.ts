import { randomUUID } from 'node:crypto'

import type { OptimizePromptResult, TextModelAlias } from '@supermind/sdk'
import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { PricingService } from '../billing/pricing.service'
import type { ChatAdapter, ChatAdapterUsage } from '../adapters/chat-adapter'
import { ChatAdapterError } from '../adapters/chat-adapter'
import { ChatAdapterRegistry } from '../adapters/chat-adapter.registry'
import { RateLimitService } from '../rate-limit/rate-limit.service'
import { RequestLifecycleService } from '../request-lifecycle/request-lifecycle.service'
import { CurrentUser } from '../user-auth/current-user.decorator'
import { USER_SESSION_COOKIE } from '../user-auth/user-auth.constants'
import type { AuthenticatedUser } from '../user-auth/user-session.service'
import { UserSessionGuard } from '../user-auth/user-session.guard'
import { OptimizePromptDto } from './dto/optimize-prompt.dto'
import { PromptTemplateRegistry } from './prompt-template.registry'

type RequestWithId = Request & { id?: string }

@ApiTags('Prompts')
@Controller('prompts')
export class PromptController {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(ChatAdapterRegistry) private readonly adapters: ChatAdapterRegistry,
    @Inject(PromptTemplateRegistry) private readonly templates: PromptTemplateRegistry,
    @Inject(RequestLifecycleService) private readonly lifecycle: RequestLifecycleService,
    @Inject(RateLimitService) private readonly rateLimit: RateLimitService,
    @Inject(PricingService) private readonly pricing: PricingService,
  ) {}

  @Post('optimize')
  @ApiCookieAuth(USER_SESSION_COOKIE)
  @UseGuards(UserSessionGuard)
  async optimize(
    @Body() input: OptimizePromptDto,
    @Req() request: RequestWithId,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OptimizePromptResult> {
    await this.rateLimit.consumeChat(request.ip)
    const requestId = request.id ?? randomUUID()
    const model = this.config.get<TextModelAlias>('PROMPT_OPTIMIZER_MODEL', 'qwen')
    const adapter = this.resolveAdapter(model)
    const template = this.templates.resolve(input.mode)
    const messages = [
      { role: 'system' as const, content: template.systemPrompt },
      { role: 'user' as const, content: input.prompt },
    ]
    const started = await this.lifecycle.start({
      userId: user.id,
      requestId,
      capability: 'prompt',
      prompt: { mode: input.mode, templateVersion: template.version, messages },
      modelAlias: model,
      provider: adapter.id,
      resolvedModel: adapter.resolvedModel,
      stream: false,
      ...(request.ip === undefined ? {} : { clientIp: request.ip }),
    })
    const abortController = new AbortController()
    const abort = () => abortController.abort()
    request.once('aborted', abort)
    let finalizationAttempted = false

    try {
      const output = await collectAdapter(adapter, {
        requestId,
        modelAlias: model,
        resolvedModel: adapter.resolvedModel,
        messages,
        signal: abortController.signal,
      })
      const usage = this.pricing.calculate(adapter.id, output.usage)
      finalizationAttempted = true
      await this.lifecycle.finish({
        requestLogId: started.id,
        requestId,
        startedAt: started.startedAt,
        status: 'succeeded',
        provider: adapter.id,
        resolvedModel: adapter.resolvedModel,
        usage,
      })
      return {
        requestId,
        model,
        optimizedPrompt: output.content,
        templateVersion: template.version,
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
          estimatedCostCny: usage.estimatedCostCny ?? null,
          usageUnknown: usage.usageUnknown,
        },
      }
    } catch (error) {
      if (!finalizationAttempted) {
        finalizationAttempted = true
        await this.lifecycle.finish({
          requestLogId: started.id,
          requestId,
          startedAt: started.startedAt,
          status: abortController.signal.aborted ? 'cancelled' : 'failed',
          ...(abortController.signal.aborted
            ? {}
            : {
                error: {
                  code:
                    error instanceof ChatAdapterError ? error.code : 'PROMPT_OPTIMIZATION_FAILED',
                  message: error instanceof Error ? error.message : 'Prompt 优化失败',
                },
              }),
        })
      }
      throw error
    } finally {
      request.removeListener('aborted', abort)
    }
  }

  private resolveAdapter(model: TextModelAlias): ChatAdapter {
    if (this.adapters.has(model)) return this.adapters.get(model)
    throw new PromptOptimizerModelUnavailableException(model)
  }
}

export class PromptOptimizerModelUnavailableException extends HttpException {
  constructor(readonly model: TextModelAlias) {
    super(
      {
        message: `Prompt 优化模型 alias "${model}" 未启用`,
        details: { model },
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    )
  }
}

async function collectAdapter(
  adapter: ChatAdapter,
  request: Parameters<ChatAdapter['stream']>[0],
): Promise<{ content: string; usage: ChatAdapterUsage }> {
  let content = ''
  let usage: ChatAdapterUsage | undefined
  let finished = false
  for await (const event of adapter.stream(request)) {
    if (event.type === 'delta') content += event.content
    else if (event.type === 'usage') usage = event.usage
    else finished = true
  }
  if (!finished || !usage) {
    throw new ChatAdapterError('Prompt adapter response is incomplete', {
      code: 'ADAPTER_PROTOCOL_ERROR',
      retryable: false,
    })
  }
  return { content, usage }
}
