import type { AgentStreamEvent } from '@supermind/sdk'
import {
  Body,
  Controller,
  HttpException,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import { ApiCookieAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Request, Response } from 'express'

import { CurrentUser } from '../user-auth/current-user.decorator'
import { USER_SESSION_COOKIE } from '../user-auth/user-auth.constants'
import type { AuthenticatedUser } from '../user-auth/user-session.service'
import { UserSessionGuard } from '../user-auth/user-session.guard'
import { TokenAnalyticsService } from '../token-analytics/token-analytics.service'
import { AgentRunEventBus } from './agent-run-event-bus'
import { AgentRunRepository } from './agent-run.repository'
import { AgentService } from './agent.service'
import { AgentUserQuestionService } from './agent-user-question.service'
import { AgentOutputFileError } from './files/agent-output-file.repository'
import { AgentOutputFileService } from './files/agent-output-file.service'
import {
  AGENT_MCP_REGISTRY,
  AgentMcpServerNotFoundError,
  type AgentMcpRegistry,
} from './mcp/agent-mcp.registry'
import { CreateAgentRunDto } from './dto/create-agent-run.dto'
import { CreateSkillUploadSessionDto } from './dto/skill-upload.dto'
import { UpdateAgentMcpServerDto } from './dto/update-agent-mcp-server.dto'
import {
  CreateAgentThreadDto,
  ListAgentThreadsQueryDto,
  UpdateAgentThreadDto,
} from './dto/agent-thread.dto'
import { AnswerAgentUserQuestionDto } from './dto/answer-agent-user-question.dto'
import { AgentSkillService } from './skills/agent-skill.service'
import { ExecutableSkillService } from './skills/executable-skill.service'
import {
  SkillUploadSessionError,
  SkillUploadSessionService,
} from './skills/upload/skill-upload-session.service'

@ApiTags('Agent')
@ApiCookieAuth(USER_SESSION_COOKIE)
@UseGuards(UserSessionGuard)
@Controller('agent')
export class AgentController {
  constructor(
    @Inject(AgentService) private readonly agent: AgentService,
    @Inject(AgentUserQuestionService) private readonly questions: AgentUserQuestionService,
    @Inject(AgentRunRepository) private readonly runs: AgentRunRepository,
    @Inject(AgentOutputFileService) private readonly outputFiles: AgentOutputFileService,
    @Inject(AgentRunEventBus) private readonly bus: AgentRunEventBus,
    @Inject(AgentSkillService) private readonly skills: AgentSkillService,
    @Inject(ExecutableSkillService) private readonly executableSkills: ExecutableSkillService,
    @Inject(SkillUploadSessionService) private readonly skillUploads: SkillUploadSessionService,
    @Inject(AGENT_MCP_REGISTRY) private readonly mcp: AgentMcpRegistry,
    @Inject(TokenAnalyticsService) private readonly tokenAnalytics: TokenAnalyticsService,
  ) {}

  @Get('token-analytics')
  async getTokenAnalytics(
    @CurrentUser() user: AuthenticatedUser,
    @Query('timezoneOffsetMinutes') rawOffset: string | undefined,
  ) {
    return this.tokenAnalytics.forUser(user.id, parseTimezoneOffset(rawOffset))
  }

  @Get('mcp/servers')
  @ApiOperation({ summary: '读取平台 MCP Server 脱敏状态' })
  @ApiOkResponse({
    description: '不返回 endpoint、认证配置、header 或 token',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'id',
          'name',
          'version',
          'description',
          'enabled',
          'status',
          'allowedToolCount',
          'discoveredToolCount',
          'registeredToolCount',
          'errorCode',
        ],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          version: { type: 'string' },
          description: { type: 'string' },
          enabled: { type: 'boolean' },
          status: { type: 'string', enum: ['configured', 'ready', 'error', 'disabled'] },
          allowedToolCount: { type: 'integer', minimum: 0 },
          discoveredToolCount: { type: 'integer', minimum: 0 },
          registeredToolCount: { type: 'integer', minimum: 0 },
          errorCode: { type: 'string', nullable: true },
        },
      },
    },
  })
  async listMcpServers(@CurrentUser() user: AuthenticatedUser) {
    return this.mcp.listStatuses(user.id)
  }

  @Patch('mcp/servers/:serverId')
  @ApiOperation({ summary: '为当前用户启用或禁用平台内置 MCP Server' })
  @ApiOkResponse({ description: '返回更新后的脱敏 Server 状态' })
  async updateMcpServer(
    @Param('serverId') serverId: string,
    @Body() body: UpdateAgentMcpServerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    try {
      return await this.mcp.setServerEnabled(user.id, serverId, body.enabled)
    } catch (error) {
      if (error instanceof AgentMcpServerNotFoundError) {
        throw new NotFoundException({
          code: 'MCP_SERVER_NOT_FOUND',
          message: error.message,
          retryable: false,
        })
      }
      throw error
    }
  }

  @Get('skills')
  async listSkills(@CurrentUser() user: AuthenticatedUser) {
    return this.skills.listMarket(user.id)
  }

  @Get('skills/executable/candidates')
  async listExecutableSkillCandidates(@CurrentUser() user: AuthenticatedUser) {
    const skills = await this.executableSkills.listCandidates(user.id)
    return skills.map(({ id, name, title, description }) => ({ id, name, title, description }))
  }

  @Put('skills/:skillId/install')
  async installSkill(@Param('skillId') skillId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.skills.install(user.id, skillId)
  }

  @Delete('skills/:skillId/install')
  @HttpCode(204)
  async uninstallSkill(
    @Param('skillId') skillId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.skills.uninstall(user.id, skillId)
  }

  @Post('skills/uploads')
  async createSkillUpload(
    @Body() body: CreateSkillUploadSessionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    try {
      const created = await this.skillUploads.create(user.id, body)
      return {
        id: created.session.id,
        expectedSizeBytes: Number(created.session.expectedSizeBytes),
        expectedSha256: created.session.expectedSha256,
        expiresAt: created.session.expiresAt.toISOString(),
        upload: created.upload,
      }
    } catch (error) {
      throwSkillUploadHttpError(error)
    }
  }

  @Post('skills/uploads/:sessionId/finalize')
  async finalizeSkillUpload(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    try {
      const finalized = await this.skillUploads.finalize(user.id, sessionId)
      if (
        finalized.status !== 'FINALIZED' ||
        finalized.observedSizeBytes === null ||
        finalized.observedSha256 === null ||
        finalized.finalizedAt === null
      ) {
        throw new SkillUploadSessionError('UPLOAD_FINALIZE_CONFLICT', '上传会话缺少终态元数据')
      }
      return {
        sessionId: finalized.id,
        status: 'finalized' as const,
        sizeBytes: Number(finalized.observedSizeBytes),
        sha256: finalized.observedSha256,
        finalizedAt: finalized.finalizedAt.toISOString(),
      }
    } catch (error) {
      throwSkillUploadHttpError(error)
    }
  }

  @Post('threads')
  async createThread(@Body() body: CreateAgentThreadDto, @CurrentUser() user: AuthenticatedUser) {
    return this.agent.createThread(user, body)
  }

  @Get('threads')
  async listThreads(
    @Query() query: ListAgentThreadsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.agent.listThreads(user, query)
  }

  @Get('threads/:threadId')
  async getThread(
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.agent.getThread(user, threadId)
  }

  @Patch('threads/:threadId')
  async renameThread(
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Body() body: UpdateAgentThreadDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.agent.renameThread(user, threadId, body.title)
  }

  @Delete('threads/:threadId')
  @HttpCode(204)
  async deleteThread(
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.agent.deleteThread(user, threadId)
  }

  @Post('threads/:threadId/runs')
  @HttpCode(202)
  async createRun(
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Body() body: CreateAgentRunDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.agent.createRun(
      user,
      threadId,
      body.input,
      body.skills ?? [],
      body.thinkingEffort ?? 'balanced',
      body.mode,
    )
  }

  @Post('runs/:runId/cancel')
  async cancelRun(
    @Param('runId', ParseUUIDPipe) runId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.agent.cancelRun(user, runId)
  }

  @Get('runs/:runId/preview')
  async openRunPreview(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Query('port', ParseIntPipe) port: number,
    @CurrentUser() user: AuthenticatedUser,
    @Res() response: Response,
  ): Promise<void> {
    const preview = await this.agent.createPreviewEndpoint(user, runId, port)
    response.redirect(HttpStatus.FOUND, preview.url)
  }

  @Post('questions/:questionId/answer')
  async answerQuestion(
    @Param('questionId', ParseUUIDPipe) questionId: string,
    @Body() body: AnswerAgentUserQuestionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.questions.answer(questionId, user.id, body.answers)
  }

  @Post('questions/:questionId/skip')
  async skipQuestion(
    @Param('questionId', ParseUUIDPipe) questionId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.questions.skip(questionId, user.id)
  }

  @Get('files/:fileId/content')
  async getOutputFile(
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Query('download') download: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Res() response: Response,
  ): Promise<void> {
    try {
      const { record, stored } = await this.outputFiles.loadForOwner(fileId, user.id)
      const shouldDownload = download === '1' || download === 'true'
      const disposition = shouldDownload ? 'attachment' : 'inline'
      response.status(200)
      response.set({
        'content-type': record.mimeType ?? stored.metadata.contentType,
        'content-length': String(stored.bytes.byteLength),
        'content-disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(record.name)}`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
      })
      response.end(Buffer.from(stored.bytes))
    } catch (error) {
      if (!(error instanceof AgentOutputFileError)) throw error
      throw new HttpException(
        {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
        },
        error.code === 'OUTPUT_FILE_NOT_FOUND'
          ? HttpStatus.NOT_FOUND
          : HttpStatus.INTERNAL_SERVER_ERROR,
      )
    }
  }

  @Get('runs/:runId/events')
  async streamEvents(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Query('after') after: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    await this.agent.assertRunOwner(user, runId)
    const cursor = parseCursor(after)

    this.openStream(response)

    let lastSequence = cursor
    let closed = false
    let notify: (() => void) | null = null
    const queue: AgentStreamEvent[] = []

    const unsubscribe = this.bus.subscribe(runId, (event) => {
      queue.push(event)
      notify?.()
    })
    const onClose = () => {
      closed = true
      notify?.()
    }
    request.once('aborted', onClose)
    response.once('close', onClose)

    const writeEvent = (event: AgentStreamEvent): boolean => {
      if (event.sequence <= lastSequence) return false
      lastSequence = event.sequence
      writeData(response, event)
      return event.type === 'run-terminal'
    }

    try {
      const persisted = await this.runs.listEventsAfter(runId, cursor)
      for (const row of persisted) {
        if (writeEvent(row.payload as AgentStreamEvent)) {
          this.endStream(response)
          return
        }
      }

      while (!closed && !response.writableEnded) {
        if (queue.length === 0) {
          if (!this.bus.isActive(runId)) break
          await new Promise<void>((resolve) => {
            notify = resolve
          })
          notify = null
          continue
        }
        const event = queue.shift()
        if (event && writeEvent(event)) {
          this.endStream(response)
          return
        }
      }

      // run 已结束（总线关闭）：补读可能遗漏的尾部事件后结束。
      const tail = await this.runs.listEventsAfter(runId, lastSequence)
      for (const row of tail) writeEvent(row.payload as AgentStreamEvent)
      this.endStream(response)
    } finally {
      unsubscribe()
      request.removeListener('aborted', onClose)
      response.removeListener('close', onClose)
    }
  }

  private openStream(response: Response): void {
    response.status(200)
    response.set({
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    response.flushHeaders()
  }

  private endStream(response: Response): void {
    if (response.writableEnded) return
    response.write('data: [DONE]\n\n')
    response.end()
  }
}

function parseTimezoneOffset(value: string | undefined): number {
  if (value === undefined) return 0
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < -840 || parsed > 840) return 0
  return parsed
}

function writeData(response: Response, payload: unknown): void {
  if (response.writableEnded) return
  response.write(`data: ${JSON.stringify(payload)}\n\n`)
}

function parseCursor(after: string | undefined): number {
  if (after === undefined) return -1
  const parsed = Number.parseInt(after, 10)
  if (Number.isNaN(parsed) || parsed < -1) return -1
  return parsed
}

function throwSkillUploadHttpError(error: unknown): never {
  if (!(error instanceof SkillUploadSessionError)) throw error
  const status =
    error.code === 'UPLOAD_SESSION_NOT_FOUND'
      ? HttpStatus.NOT_FOUND
      : error.code === 'UPLOAD_OBJECT_MISMATCH'
        ? HttpStatus.BAD_REQUEST
        : HttpStatus.CONFLICT
  throw new HttpException(
    {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    },
    status,
  )
}
