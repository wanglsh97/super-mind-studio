import { InMemorySkillObjectStore } from './storage/in-memory-skill-object-store'
import {
  MOCK_EXECUTABLE_SKILL,
  MOCK_EXECUTABLE_SKILL_PACKAGE,
  MOCK_EXECUTABLE_SKILL_SHA256,
} from './executable-skill.fixture'
import {
  AgentSkillAddLimitError,
  type ExecutableSkillRecord,
  type ExecutableSkillRepositoryPort,
} from './executable-skill.repository'
import {
  ExecutableSkillError,
  ExecutableSkillService,
  MAX_ADDED_AGENT_SKILLS,
} from './executable-skill.service'

class FakeExecutableSkillRepository implements ExecutableSkillRepositoryPort {
  private readonly published = new Map<string, ExecutableSkillRecord>()
  private readonly added = new Map<string, Set<string>>()

  constructor(skills: readonly ExecutableSkillRecord[] = [mockSkillRecord()]) {
    for (const skill of skills) this.published.set(skill.name, skill)
  }

  async ensureMockPublishedSkill(): Promise<ExecutableSkillRecord> {
    const skill = mockSkillRecord()
    this.published.set(skill.name, skill)
    return skill
  }

  async findPublishedByName(name: string): Promise<ExecutableSkillRecord | null> {
    const skill = this.published.get(name)
    return skill?.status === 'PUBLISHED' ? skill : null
  }

  async findAddedPublishedByName(
    userId: string,
    name: string,
  ): Promise<ExecutableSkillRecord | null> {
    const skill = await this.findPublishedByName(name)
    return skill && this.added.get(userId)?.has(skill.id) ? skill : null
  }

  async findAddedByName(userId: string, name: string): Promise<ExecutableSkillRecord | null> {
    const skill = this.published.get(name)
    return skill && this.added.get(userId)?.has(skill.id) ? skill : null
  }

  async listAddedPublished(userId: string): Promise<ExecutableSkillRecord[]> {
    const ids = this.added.get(userId) ?? new Set()
    return [...this.published.values()]
      .filter((skill) => skill.status === 'PUBLISHED' && ids.has(skill.id))
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  async addForUser(userId: string, skill: ExecutableSkillRecord, limit: number): Promise<boolean> {
    const added = this.added.get(userId) ?? new Set<string>()
    if (added.has(skill.id)) return false
    if (added.size >= limit) throw new AgentSkillAddLimitError(limit)
    added.add(skill.id)
    this.added.set(userId, added)
    return true
  }

  async removeForUser(userId: string, skillId: string): Promise<void> {
    this.added.get(userId)?.delete(skillId)
  }
}

function mockSkillRecord(overrides: Partial<ExecutableSkillRecord> = {}): ExecutableSkillRecord {
  return {
    id: MOCK_EXECUTABLE_SKILL.id,
    name: MOCK_EXECUTABLE_SKILL.name,
    title: MOCK_EXECUTABLE_SKILL.title,
    description: MOCK_EXECUTABLE_SKILL.description,
    status: 'PUBLISHED',
    packageObjectKey: MOCK_EXECUTABLE_SKILL.objectKey,
    packageSha256: MOCK_EXECUTABLE_SKILL_SHA256,
    ...overrides,
  }
}

function setup(
  repository: ExecutableSkillRepositoryPort = new FakeExecutableSkillRepository(),
  objectStore = new InMemorySkillObjectStore({
    skillPackages: [MOCK_EXECUTABLE_SKILL_PACKAGE],
  }),
) {
  return {
    repository,
    objectStore,
    service: new ExecutableSkillService(repository, objectStore),
  }
}

describe('ExecutableSkillService', () => {
  it('exposes one deterministic published fixture and adds/removes it idempotently', async () => {
    const { service } = setup()
    await expect(service.ensureMockPublishedSkill()).resolves.toMatchObject({
      name: 'mock-data-cleaner',
      status: 'PUBLISHED',
    })
    await service.add('user-1', 'mock-data-cleaner')
    await service.add('user-1', 'mock-data-cleaner')
    await expect(service.listCandidates('user-1')).resolves.toHaveLength(1)

    await service.remove('user-1', 'mock-data-cleaner')
    await service.remove('user-1', 'mock-data-cleaner')
    await expect(service.listCandidates('user-1')).resolves.toEqual([])
  })

  it('prepares an added Skill with a scoped current-package download and observed hash', async () => {
    const { service } = setup()
    await service.add('user-1', 'mock-data-cleaner')

    const prepared = await service.prepareActivation('user-1', [
      'mock-data-cleaner',
      'mock-data-cleaner',
    ])

    expect(prepared).toHaveLength(1)
    expect(prepared[0]).toMatchObject({
      manifest: {
        skillId: MOCK_EXECUTABLE_SKILL.id,
        name: 'mock-data-cleaner',
        packageSha256: MOCK_EXECUTABLE_SKILL_SHA256,
      },
      download: {
        metadata: {
          objectKey: MOCK_EXECUTABLE_SKILL.objectKey,
          sha256: MOCK_EXECUTABLE_SKILL_SHA256,
        },
        url: expect.stringMatching(/^data:application\/zip;base64,/),
      },
    })
  })

  it('rejects unavailable, not-added and hash-mismatched packages without fallback', async () => {
    const missingStore = new InMemorySkillObjectStore()
    const missing = setup(new FakeExecutableSkillRepository(), missingStore).service
    await missing.add('user-1', 'mock-data-cleaner')
    await expect(missing.prepareActivation('user-1', ['mock-data-cleaner'])).rejects.toMatchObject({
      code: 'SKILL_PACKAGE_UNAVAILABLE',
    })

    const notAdded = setup().service
    await expect(
      notAdded.prepareActivation('user-1', ['mock-data-cleaner']),
    ).rejects.toBeInstanceOf(ExecutableSkillError)
    await expect(notAdded.prepareActivation('user-1', ['mock-data-cleaner'])).rejects.toMatchObject(
      {
        code: 'SKILL_NOT_ADDED',
      },
    )

    const wrongHashRepository = new FakeExecutableSkillRepository([
      mockSkillRecord({ packageSha256: 'f'.repeat(64) }),
    ])
    const mismatch = setup(wrongHashRepository).service
    await mismatch.add('user-1', 'mock-data-cleaner')
    await expect(mismatch.prepareActivation('user-1', ['mock-data-cleaner'])).rejects.toMatchObject(
      {
        code: 'SKILL_PACKAGE_INTEGRITY_FAILED',
      },
    )
  })

  it('enforces the 50-Skill added limit while keeping repeat adds idempotent', async () => {
    const skills = Array.from({ length: MAX_ADDED_AGENT_SKILLS + 1 }, (_, index) =>
      mockSkillRecord({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        name: `fixture-${index}`,
      }),
    )
    const service = setup(new FakeExecutableSkillRepository(skills)).service
    for (const skill of skills.slice(0, MAX_ADDED_AGENT_SKILLS)) {
      await service.add('user-1', skill.name)
    }
    await service.add('user-1', skills[0]!.name)

    await expect(service.add('user-1', skills.at(-1)!.name)).rejects.toMatchObject({
      limit: MAX_ADDED_AGENT_SKILLS,
    })
  })
})
