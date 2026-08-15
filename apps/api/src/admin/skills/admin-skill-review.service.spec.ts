import type {
  AdminSkillReviewRepositoryPort,
  PendingSkillReviewRecord,
  SkillReviewOutcome,
} from './admin-skill-review.repository';
import { AdminSkillReviewError, AdminSkillReviewService } from './admin-skill-review.service';

describe('AdminSkillReviewService', () => {
  it('publishes or rejects a pending Skill and persists the normalized reason', async () => {
    const approvedRepository = new MemoryReviewRepository();
    const approved = await new AdminSkillReviewService(approvedRepository as never).approve(
      'skill-1',
    );
    expect(approved.status).toBe('PUBLISHED');
    expect(approvedRepository.lastDecision).toMatchObject({
      outcome: 'approved',
      reason: null,
      reviewer: 'root',
    });

    const rejectedRepository = new MemoryReviewRepository();
    const rejected = await new AdminSkillReviewService(rejectedRepository as never).reject(
      'skill-1',
      '  缺少使用说明  ',
    );
    expect(rejected.status).toBe('REJECTED');
    expect(rejectedRepository.lastDecision).toMatchObject({
      outcome: 'rejected',
      reason: '缺少使用说明',
    });
  });

  it('requires a bounded rejection reason', async () => {
    const service = new AdminSkillReviewService(new MemoryReviewRepository() as never);
    await expect(service.reject('skill-1', '   ')).rejects.toBeInstanceOf(AdminSkillReviewError);
    await expect(service.reject('skill-1', 'x'.repeat(501))).rejects.toMatchObject({
      code: 'SKILL_REJECTION_REASON_INVALID',
    });
  });

  it('delists through the fixed administrator boundary', async () => {
    const repository = new MemoryReviewRepository();
    await expect(
      new AdminSkillReviewService(repository as never).delist('skill-1'),
    ).resolves.toMatchObject({ status: 'DELISTED' });
    expect(repository.lastDecision).toMatchObject({ outcome: 'delisted', reviewer: 'root' });
  });
});

class MemoryReviewRepository implements AdminSkillReviewRepositoryPort {
  private record: PendingSkillReviewRecord = {
    id: 'skill-1',
    name: 'review-me',
    title: 'Review me',
    description: 'Pending review.',
    category: 'development',
    ownerId: 'owner-1',
    packageSha256: 'a'.repeat(64),
    status: 'PENDING_REVIEW',
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };

  lastDecision:
    | { outcome: SkillReviewOutcome | 'delisted'; reason: string | null; reviewer: string }
    | undefined;

  async listPending(): Promise<PendingSkillReviewRecord[]> {
    return this.record.status === 'PENDING_REVIEW' ? [this.record] : [];
  }

  async decide(
    _skillId: string,
    outcome: SkillReviewOutcome,
    reason: string | null,
    reviewer: string,
  ): Promise<PendingSkillReviewRecord> {
    this.lastDecision = { outcome, reason, reviewer };
    this.record = {
      ...this.record,
      status: outcome === 'approved' ? 'PUBLISHED' : 'REJECTED',
    };
    return this.record;
  }

  async delist(_skillId: string, reviewer: string): Promise<PendingSkillReviewRecord> {
    this.lastDecision = { outcome: 'delisted', reason: null, reviewer };
    this.record = { ...this.record, status: 'DELISTED' };
    return this.record;
  }
}
