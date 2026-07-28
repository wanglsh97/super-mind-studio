import type { PrismaService } from '../../database/prisma.service'
import { AgentMcpPreferenceRepository } from './agent-mcp-preference.repository'

describe('AgentMcpPreferenceRepository', () => {
  it('returns only the authenticated user preferences', async () => {
    const findMany = jest.fn(async () => [
      { serverId: 'context7', enabled: false },
      { serverId: 'deepwiki', enabled: true },
    ])
    const repository = new AgentMcpPreferenceRepository({
      userMcpServerPreference: { findMany },
    } as unknown as PrismaService)

    await expect(repository.listForUser('user-1')).resolves.toEqual(
      new Map([
        ['context7', false],
        ['deepwiki', true],
      ]),
    )
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-1' } }))
  })

  it('upserts by user and platform server ID', async () => {
    const upsert = jest.fn(async () => undefined)
    const repository = new AgentMcpPreferenceRepository({
      userMcpServerPreference: { upsert },
    } as unknown as PrismaService)

    await repository.setEnabled('user-1', 'context7', false)

    expect(upsert).toHaveBeenCalledWith({
      where: { userId_serverId: { userId: 'user-1', serverId: 'context7' } },
      create: { userId: 'user-1', serverId: 'context7', enabled: false },
      update: { enabled: false },
    })
  })
})
