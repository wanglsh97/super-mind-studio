import type { PrismaService } from '../database/prisma.service'
import { AgentThreadRepository } from './agent-thread.repository'

function setup() {
  const create = jest.fn()
  const findMany = jest.fn()
  const findFirst = jest.fn()
  const updateMany = jest.fn()
  const deleteMany = jest.fn()
  const count = jest.fn()
  const prisma = {
    agentThread: { create, findMany, findFirst, updateMany, deleteMany, count },
  } as unknown as PrismaService
  return {
    create,
    findMany,
    findFirst,
    updateMany,
    deleteMany,
    count,
    repository: new AgentThreadRepository(prisma),
  }
}

describe('AgentThreadRepository', () => {
  it('always scopes reads by the owner userId and sorts by updatedAt desc', async () => {
    const { findFirst, findMany, count, repository } = setup()
    findFirst.mockResolvedValue(null)
    findMany.mockResolvedValue([])
    count.mockResolvedValue(0)

    await repository.findSummaryForOwner('thread-1', 'user-a')
    await repository.listForOwner('user-a', { skip: 0, take: 50 })

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'thread-1', userId: 'user-a' } }),
    )
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-a' },
        orderBy: { updatedAt: 'desc' },
        skip: 0,
        take: 50,
      }),
    )
    expect(count).toHaveBeenCalledWith({ where: { userId: 'user-a' } })
  })

  it('returns paginated rows with total for boundary pages', async () => {
    const { findMany, count, repository } = setup()
    findMany.mockResolvedValue([{ id: 'thread-2' }])
    count.mockResolvedValue(51)

    await expect(repository.listForOwner('user-a', { skip: 50, take: 50 })).resolves.toEqual({
      rows: [{ id: 'thread-2' }],
      total: 51,
    })
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 50, take: 50 }))
  })

  it('returns null when a thread belongs to another user', async () => {
    const { findFirst, repository } = setup()
    findFirst.mockResolvedValue(null)

    await expect(repository.findSummaryForOwner('thread-of-a', 'user-b')).resolves.toBeNull()
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'thread-of-a', userId: 'user-b' } }),
    )
  })

  it('reports a miss when rename/delete does not match the owner scope', async () => {
    const { updateMany, deleteMany, repository } = setup()
    updateMany.mockResolvedValue({ count: 0 })
    deleteMany.mockResolvedValue({ count: 0 })

    await expect(repository.renameForOwner('thread-of-a', 'user-b', '新标题')).resolves.toBe(false)
    await expect(repository.deleteForOwner('thread-of-a', 'user-b')).resolves.toBe(false)
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'thread-of-a', userId: 'user-b' },
      data: { title: '新标题' },
    })
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: 'thread-of-a', userId: 'user-b' } })
  })

  it('confirms owner-scoped rename/delete hits', async () => {
    const { updateMany, deleteMany, repository } = setup()
    updateMany.mockResolvedValue({ count: 1 })
    deleteMany.mockResolvedValue({ count: 1 })

    await expect(repository.renameForOwner('thread-1', 'user-a', 'x')).resolves.toBe(true)
    await expect(repository.deleteForOwner('thread-1', 'user-a')).resolves.toBe(true)
  })

  it('updates modelId and provider together within the owner scope', async () => {
    const { updateMany, repository } = setup()
    updateMany.mockResolvedValue({ count: 1 })

    await expect(
      repository.updateModelForOwner('thread-1', 'user-a', 'glm-5.2', 'glm'),
    ).resolves.toBe(true)
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'thread-1', userId: 'user-a' },
      data: { modelId: 'glm-5.2', provider: 'glm' },
    })
  })

  it('persists and clears a Thread-owned Sandbox with owner-scoped updates', async () => {
    const { findFirst, updateMany, repository } = setup()
    findFirst.mockResolvedValue(null)
    updateMany.mockResolvedValue({ count: 1 })
    const createdAt = new Date('2026-07-27T00:00:00.000Z')
    const expiresAt = new Date('2026-07-27T00:30:00.000Z')

    await repository.findSandboxForOwner('thread-1', 'user-a')
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'thread-1', userId: 'user-a' }),
      }),
    )

    await repository.markSandboxReady('thread-1', 'user-a', {
      sandboxId: 'sandbox-1',
      createdAt,
      expiresAt,
      lastUsedAt: createdAt,
    })
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'thread-1', userId: 'user-a' },
      data: expect.objectContaining({
        sandboxId: 'sandbox-1',
        sandboxStatus: 'ready',
        sandboxCreatedAt: createdAt,
        sandboxLastUsedAt: createdAt,
        sandboxExpiresAt: expiresAt,
      }),
    })

    await repository.clearSandbox('thread-1', 'sandbox-1', expiresAt)
    expect(updateMany).toHaveBeenLastCalledWith({
      where: { id: 'thread-1', sandboxId: 'sandbox-1' },
      data: expect.objectContaining({
        sandboxId: null,
        sandboxStatus: null,
        sandboxDestroyedAt: expiresAt,
      }),
    })
  })
})
