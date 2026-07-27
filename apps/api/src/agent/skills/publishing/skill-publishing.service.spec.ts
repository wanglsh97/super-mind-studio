import type { AgentSkillCategory } from '@supermind/sdk'

import {
  SkillClaimPersistenceError,
  type ClaimedSkillRecord,
  type ClaimSkillInput,
  type SkillPublishingRepositoryPort,
  type UpdatePublishedSkillInput,
} from './skill-publishing.repository'
import { SkillPublishingError, SkillPublishingService } from './skill-publishing.service'

describe('SkillPublishingService', () => {
  it('normalizes metadata and claims a globally named pending Skill', async () => {
    const repository = new MemoryPublishingRepository()
    const service = new SkillPublishingService(repository as never)

    await expect(
      service.claim('user-1', {
        uploadSessionId: 'upload-1',
        name: 'csv-cleaner',
        title: '  CSV Cleaner  ',
        description: '  Cleans CSV files.  ',
        category: 'data',
      }),
    ).resolves.toMatchObject({
      name: 'csv-cleaner',
      ownerId: 'user-1',
      title: 'CSV Cleaner',
      description: 'Cleans CSV files.',
      category: 'data',
      status: 'PENDING_REVIEW',
    })
  })

  it.each([
    { name: '../unsafe', category: 'data' },
    { name: '-leading', category: 'data' },
    { name: 'valid-name', category: 'custom' },
  ])('rejects invalid fixed identity metadata %#', async ({ name, category }) => {
    const service = new SkillPublishingService(new MemoryPublishingRepository() as never)
    await expect(
      service.claim('user-1', {
        uploadSessionId: 'upload-1',
        name,
        title: 'Title',
        description: 'Description',
        category: category as AgentSkillCategory,
      }),
    ).rejects.toBeInstanceOf(SkillPublishingError)
  })

  it('maps name conflicts and rejects cross-user overwrite authorization', async () => {
    const repository = new MemoryPublishingRepository()
    const service = new SkillPublishingService(repository as never)
    const input = {
      uploadSessionId: 'upload-1',
      name: 'owned-skill',
      title: 'Owned',
      description: 'Owned description',
      category: 'development' as const,
    }
    await service.claim('owner-1', input)
    await expect(
      service.claim('owner-2', { ...input, uploadSessionId: 'upload-2' }),
    ).rejects.toMatchObject({ code: 'SKILL_NAME_TAKEN' })
    await expect(service.requireOwner('owner-2', input.name)).rejects.toMatchObject({
      code: 'SKILL_NOT_OWNER',
    })
    await expect(service.requireOwner('owner-1', input.name)).resolves.toMatchObject({
      ownerId: 'owner-1',
    })
  })

  it('updates a published owner Skill without returning it to review', async () => {
    const repository = new MemoryPublishingRepository()
    const service = new SkillPublishingService(repository as never)
    const skill = await repository.claim({
      userId: 'owner-1',
      uploadSessionId: 'upload-1',
      name: 'published-skill',
      title: 'Old title',
      description: 'Old description',
      category: 'development',
    })
    skill.status = 'PUBLISHED'

    await expect(
      service.updatePublished('owner-1', skill.name, {
        uploadSessionId: 'upload-2',
        title: '  New title  ',
        description: '  New description  ',
        category: 'productivity',
      }),
    ).resolves.toMatchObject({
      id: skill.id,
      status: 'PUBLISHED',
      title: 'New title',
      description: 'New description',
      category: 'productivity',
      packageSha256: 'b'.repeat(64),
    })
  })

  it('allows only the owner to delist a published Skill', async () => {
    const repository = new MemoryPublishingRepository()
    const service = new SkillPublishingService(repository as never)
    const skill = await repository.claim({
      userId: 'owner-1',
      uploadSessionId: 'upload-1',
      name: 'delist-skill',
      title: 'Delist',
      description: 'Delist description',
      category: 'development',
    })
    skill.status = 'PUBLISHED'

    await expect(service.delistOwned('other-user', skill.name)).rejects.toMatchObject({
      code: 'SKILL_NOT_OWNER',
    })
    await expect(service.delistOwned('owner-1', skill.name)).resolves.toMatchObject({
      status: 'DELISTED',
    })
  })
})

class MemoryPublishingRepository implements SkillPublishingRepositoryPort {
  private readonly skills = new Map<string, ClaimedSkillRecord>()

  async claim(input: ClaimSkillInput): Promise<ClaimedSkillRecord> {
    if (this.skills.has(input.name)) {
      throw new SkillClaimPersistenceError('SKILL_NAME_TAKEN', 'taken')
    }
    const record: ClaimedSkillRecord = {
      id: `skill-${this.skills.size + 1}`,
      name: input.name,
      ownerId: input.userId,
      title: input.title,
      description: input.description,
      category: input.category,
      status: 'PENDING_REVIEW',
      packageObjectKey: `staging/${input.uploadSessionId}.zip`,
      packageSha256: 'a'.repeat(64),
      packageSizeBytes: 1n,
    }
    this.skills.set(record.name, record)
    return record
  }

  async findByName(name: string): Promise<ClaimedSkillRecord | null> {
    return this.skills.get(name) ?? null
  }

  async listOwned(userId: string): Promise<ClaimedSkillRecord[]> {
    return [...this.skills.values()].filter((skill) => skill.ownerId === userId)
  }

  async updatePublished(input: UpdatePublishedSkillInput): Promise<ClaimedSkillRecord> {
    const skill = this.skills.get(input.name)
    if (!skill) throw new SkillClaimPersistenceError('SKILL_NOT_FOUND', 'not found')
    if (skill.ownerId !== input.userId) {
      throw new SkillClaimPersistenceError('SKILL_NOT_OWNER', 'not owner')
    }
    if (skill.status !== 'PUBLISHED') {
      throw new SkillClaimPersistenceError('SKILL_NOT_PUBLISHED', 'not published')
    }
    Object.assign(skill, {
      title: input.title,
      description: input.description,
      category: input.category,
      packageSha256: 'b'.repeat(64),
      packageSizeBytes: 2n,
    })
    return skill
  }

  async delistOwned(userId: string, name: string): Promise<ClaimedSkillRecord> {
    const skill = this.skills.get(name)
    if (!skill) throw new SkillClaimPersistenceError('SKILL_NOT_FOUND', 'not found')
    if (skill.ownerId !== userId) {
      throw new SkillClaimPersistenceError('SKILL_NOT_OWNER', 'not owner')
    }
    if (skill.status !== 'PUBLISHED') {
      throw new SkillClaimPersistenceError('SKILL_DELIST_INVALID_TRANSITION', 'not published')
    }
    skill.status = 'DELISTED'
    return skill
  }
}
