import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common'
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger'

import { CurrentUser } from '../../../user-auth/current-user.decorator'
import { USER_SESSION_COOKIE } from '../../../user-auth/user-auth.constants'
import type { AuthenticatedUser } from '../../../user-auth/user-session.service'
import { UserSessionGuard } from '../../../user-auth/user-session.guard'
import { AgentSkillAddLimitError } from '../executable-skill.repository'
import { ExecutableSkillError, ExecutableSkillService } from '../executable-skill.service'
import {
  SkillPublishingError,
  SkillPublishingService,
} from '../publishing/skill-publishing.service'
import { ListSkillMarketQueryDto } from './skill-market.dto'
import { SkillMarketService } from './skill-market.service'
import { SubmitSkillDto, UpdatePublishedSkillDto } from './skill-owner.dto'

@ApiTags('Skill Market')
@Controller('skills')
export class SkillMarketController {
  constructor(
    @Inject(SkillMarketService) private readonly market: SkillMarketService,
    @Inject(SkillPublishingService) private readonly publishing: SkillPublishingService,
    @Inject(ExecutableSkillService) private readonly executable: ExecutableSkillService,
  ) {}

  @Get()
  list(@Query() query: ListSkillMarketQueryDto) {
    return this.market.list(query)
  }

  @Get('owner')
  @ApiCookieAuth(USER_SESSION_COOKIE)
  @UseGuards(UserSessionGuard)
  async listOwned(@CurrentUser() user: AuthenticatedUser) {
    return (await this.publishing.listOwned(user.id)).map(toOwnerResponse)
  }

  @Post('owner')
  @ApiCookieAuth(USER_SESSION_COOKIE)
  @UseGuards(UserSessionGuard)
  async submit(@Body() body: SubmitSkillDto, @CurrentUser() user: AuthenticatedUser) {
    try {
      return toOwnerResponse(await this.publishing.claim(user.id, body))
    } catch (error) {
      throwPublishingHttpError(error)
    }
  }

  @Patch('owner/:name')
  @ApiCookieAuth(USER_SESSION_COOKIE)
  @UseGuards(UserSessionGuard)
  async updateOwned(
    @Param('name') name: string,
    @Body() body: UpdatePublishedSkillDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    try {
      return toOwnerResponse(await this.publishing.updatePublished(user.id, name, body))
    } catch (error) {
      throwPublishingHttpError(error)
    }
  }

  @Delete('owner/:name')
  @ApiCookieAuth(USER_SESSION_COOKIE)
  @UseGuards(UserSessionGuard)
  async delistOwned(@Param('name') name: string, @CurrentUser() user: AuthenticatedUser) {
    try {
      return toOwnerResponse(await this.publishing.delistOwned(user.id, name))
    } catch (error) {
      throwPublishingHttpError(error)
    }
  }

  @Put(':name/add')
  @HttpCode(204)
  @ApiCookieAuth(USER_SESSION_COOKIE)
  @UseGuards(UserSessionGuard)
  async add(@Param('name') name: string, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    try {
      await this.executable.add(user.id, name)
    } catch (error) {
      if (error instanceof AgentSkillAddLimitError) {
        throw new HttpException(
          { code: 'SKILL_ADD_LIMIT', message: error.message, retryable: false },
          HttpStatus.CONFLICT,
        )
      }
      if (error instanceof ExecutableSkillError) {
        throw new HttpException(
          { code: error.code, message: error.message, retryable: error.retryable },
          HttpStatus.NOT_FOUND,
        )
      }
      throw error
    }
  }

  @Delete(':name/add')
  @HttpCode(204)
  @ApiCookieAuth(USER_SESSION_COOKIE)
  @UseGuards(UserSessionGuard)
  async remove(@Param('name') name: string, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.executable.remove(user.id, name)
  }

  @Get(':name/files')
  filePreview(@Param('name') name: string, @Query('path') path: string) {
    return this.market.filePreview(name, path)
  }

  @Get(':name')
  detail(@Param('name') name: string) {
    return this.market.detail(name)
  }
}

function toOwnerResponse(skill: {
  id: string
  name: string
  title: string
  description: string
  category: string
  status: string
  packageSha256: string | null
  packageSizeBytes: bigint | null
}) {
  return {
    id: skill.id,
    name: skill.name,
    title: skill.title,
    description: skill.description,
    category: skill.category,
    publicationStatus: skill.status.toLowerCase(),
    packageSha256: skill.packageSha256,
    packageSizeBytes: skill.packageSizeBytes === null ? null : Number(skill.packageSizeBytes),
  }
}

function throwPublishingHttpError(error: unknown): never {
  if (!(error instanceof SkillPublishingError)) throw error
  const status =
    error.code === 'SKILL_NOT_FOUND'
      ? HttpStatus.NOT_FOUND
      : error.code === 'SKILL_NOT_OWNER'
        ? HttpStatus.FORBIDDEN
        : error.code.endsWith('INVALID')
          ? HttpStatus.BAD_REQUEST
          : HttpStatus.CONFLICT
  throw new HttpException(
    { code: error.code, message: error.message, retryable: error.retryable },
    status,
  )
}
