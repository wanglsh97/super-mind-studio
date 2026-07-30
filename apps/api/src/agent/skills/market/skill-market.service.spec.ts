import { BadRequestException } from '@nestjs/common'

import { SkillMarketService, type PublicSkillMarketPage } from './skill-market.service'
import type { SkillMarketQuery, SkillMarketRepositoryPort } from './skill-market.repository'
import type { SkillObjectStorePort } from '../storage/skill-object-store.port'

describe('SkillMarketService', () => {
  const repository: jest.Mocked<SkillMarketRepositoryPort> = {
    listPublished: jest.fn(),
    findPublishedByName: jest.fn(),
  }
  const objects: jest.Mocked<Pick<SkillObjectStorePort, 'loadSkillPackage'>> = {
    loadSkillPackage: jest.fn(),
  }
  const service = new SkillMarketService(repository, objects as unknown as SkillObjectStorePort)

  beforeEach(() => {
    jest.clearAllMocks()
    repository.listPublished.mockResolvedValue({ items: [], total: 0 })
    objects.loadSkillPackage.mockResolvedValue(null)
  })

  it('normalizes HTTP query-string pagination before calling Prisma', async () => {
    const result = await service.list({
      page: '1',
      pageSize: '12',
      sort: 'latest',
    } as unknown as SkillMarketQuery)

    expect(repository.listPublished).toHaveBeenCalledWith({
      page: 1,
      pageSize: 12,
      sort: 'latest',
    })
    expect(result).toEqual<PublicSkillMarketPage>({
      items: [],
      page: 1,
      pageSize: 12,
      total: 0,
      totalPages: 0,
    })
  })

  it.each([
    ['page', '0'],
    ['page', 'not-a-number'],
    ['pageSize', '51'],
  ] as const)('rejects invalid %s query values', async (field, value) => {
    const query = {
      page: field === 'page' ? value : '1',
      pageSize: field === 'pageSize' ? value : '12',
      sort: 'latest',
    } as unknown as SkillMarketQuery

    await expect(service.list(query)).rejects.toBeInstanceOf(BadRequestException)
    expect(repository.listPublished).not.toHaveBeenCalled()
  })

  it('falls back to the stored package projection when a legacy Skill has no file tree', async () => {
    repository.findPublishedByName.mockResolvedValue({
      id: 'skill-1',
      name: 'weather',
      title: 'weather',
      description: 'Forecasts',
      category: 'research',
      addCount: 1,
      updatedAt: new Date('2026-07-30T00:00:00.000Z'),
      packageObjectKey: 'skills/weather/package.zip',
      skillMarkdown: null,
      fileTree: null,
    })
    objects.loadSkillPackage.mockResolvedValue({
      metadata: {
        objectKey: 'skills/weather/package.zip',
        kind: 'skill-package',
        contentType: 'application/zip',
        sizeBytes: 120,
        sha256: 'a'.repeat(64),
        updatedAt: '2026-07-30T00:00:00.000Z',
      },
      archive: new Uint8Array(),
      skillMarkdown: '# Weather',
      files: [{ path: 'SKILL.md', type: 'file', size: 9 }],
    })

    await expect(service.detail('weather')).resolves.toMatchObject({
      skillMarkdown: '# Weather',
      files: [{ path: 'SKILL.md', type: 'file', size: 9 }],
    })
  })
})
