import { Module } from '@nestjs/common';

import { AdminSkillReviewController } from './admin-skill-review.controller';
import { AdminSkillReviewRepository } from './admin-skill-review.repository';
import { AdminSkillReviewService } from './admin-skill-review.service';

@Module({
  controllers: [AdminSkillReviewController],
  providers: [AdminSkillReviewRepository, AdminSkillReviewService],
})
export class AdminSkillReviewModule {}
