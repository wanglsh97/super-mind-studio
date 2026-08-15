import { Inject, Injectable } from '@nestjs/common';

import {
  AdminSkillReviewRepository,
  SkillReviewPersistenceError,
  type AdminSkillReviewRepositoryPort,
  type PendingSkillReviewRecord,
} from './admin-skill-review.repository';

export const SKILL_REJECTION_REASON_MAX_LENGTH = 500;

@Injectable()
export class AdminSkillReviewService {
  constructor(
    @Inject(AdminSkillReviewRepository)
    private readonly repository: AdminSkillReviewRepositoryPort,
  ) {}

  listPending(): Promise<PendingSkillReviewRecord[]> {
    return this.repository.listPending();
  }

  approve(skillId: string): Promise<PendingSkillReviewRecord> {
    return this.decide(skillId, 'approved', null);
  }

  async reject(skillId: string, reason: string): Promise<PendingSkillReviewRecord> {
    const normalized = reason.trim();
    if (!normalized || normalized.length > SKILL_REJECTION_REASON_MAX_LENGTH) {
      throw new AdminSkillReviewError(
        'SKILL_REJECTION_REASON_INVALID',
        `驳回原因须为 1–${SKILL_REJECTION_REASON_MAX_LENGTH} 个字符`,
      );
    }
    return this.decide(skillId, 'rejected', normalized);
  }

  async delist(skillId: string): Promise<PendingSkillReviewRecord> {
    try {
      return await this.repository.delist(skillId, 'root', new Date());
    } catch (error) {
      if (error instanceof SkillReviewPersistenceError) {
        throw new AdminSkillReviewError(error.code, error.message);
      }
      throw error;
    }
  }

  private async decide(
    skillId: string,
    outcome: 'approved' | 'rejected',
    reason: string | null,
  ): Promise<PendingSkillReviewRecord> {
    try {
      return await this.repository.decide(skillId, outcome, reason, 'root', new Date());
    } catch (error) {
      if (error instanceof SkillReviewPersistenceError) {
        throw new AdminSkillReviewError(error.code, error.message);
      }
      throw error;
    }
  }
}

export class AdminSkillReviewError extends Error {
  readonly retryable = false;

  constructor(
    readonly code:
      | 'SKILL_NOT_FOUND'
      | 'SKILL_REVIEW_INVALID_TRANSITION'
      | 'SKILL_PACKAGE_MISSING'
      | 'SKILL_DELIST_INVALID_TRANSITION'
      | 'SKILL_REJECTION_REASON_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'AdminSkillReviewError';
  }
}
