import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';

import { ADMIN_SESSION_COOKIE } from '../auth/admin-auth.service';
import { AdminSkillReviewError, AdminSkillReviewService } from './admin-skill-review.service';
import { RejectSkillDto } from './dto/reject-skill.dto';

@ApiTags('Admin')
@ApiCookieAuth(ADMIN_SESSION_COOKIE)
@Controller('admin/skills')
export class AdminSkillReviewController {
  constructor(@Inject(AdminSkillReviewService) private readonly reviews: AdminSkillReviewService) {}

  @Get('reviews')
  listPending() {
    return this.reviews.listPending();
  }

  @Post(':skillId/approve')
  async approve(@Param('skillId', ParseUUIDPipe) skillId: string) {
    try {
      return await this.reviews.approve(skillId);
    } catch (error) {
      throwReviewHttpError(error);
    }
  }

  @Post(':skillId/reject')
  async reject(@Param('skillId', ParseUUIDPipe) skillId: string, @Body() body: RejectSkillDto) {
    try {
      return await this.reviews.reject(skillId, body.reason);
    } catch (error) {
      throwReviewHttpError(error);
    }
  }

  @Post(':skillId/delist')
  async delist(@Param('skillId', ParseUUIDPipe) skillId: string) {
    try {
      return await this.reviews.delist(skillId);
    } catch (error) {
      throwReviewHttpError(error);
    }
  }
}

function throwReviewHttpError(error: unknown): never {
  if (!(error instanceof AdminSkillReviewError)) throw error;
  const status =
    error.code === 'SKILL_NOT_FOUND'
      ? HttpStatus.NOT_FOUND
      : error.code === 'SKILL_REJECTION_REASON_INVALID'
        ? HttpStatus.BAD_REQUEST
        : HttpStatus.CONFLICT;
  throw new HttpException(
    { code: error.code, message: error.message, retryable: error.retryable },
    status,
  );
}
