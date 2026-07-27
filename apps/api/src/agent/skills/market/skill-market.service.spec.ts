import { BadRequestException } from '@nestjs/common'

import { SkillMarketService, type PublicSkillMarketPage } from './skill-market.service'
import type { SkillMarketQuery, SkillMarketRepositoryPort } from './skill-market.repository'

describe('SkillMarketService', () => {
  const repository: jest.Mocked<SkillMarketRepositoryPort> = {
    listPublished: jest.fn(),
    findPublishedByName: jest.fn(),
  }
  const service = new SkillMarketService(repository)

  beforeEach(() => {
    jest.clearAllMocks()
    repository.listPublished.mockResolvedValue({ items: [], total: 0 })
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
})
