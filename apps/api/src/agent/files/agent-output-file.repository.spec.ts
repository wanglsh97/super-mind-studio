import type { PrismaService } from '../../database/prisma.service'
import { AgentOutputFileRepository } from './agent-output-file.repository'

const MIB = 1024 * 1024

function setup(runBytes: bigint, userBytes: bigint) {
  const aggregate = jest
    .fn()
    .mockResolvedValueOnce({ _sum: { sizeBytes: runBytes } })
    .mockResolvedValueOnce({ _sum: { sizeBytes: userBytes } })
  const transaction = {
    userFile: {
      findUnique: jest.fn().mockResolvedValue(null),
      aggregate,
      create: jest.fn(),
    },
  }
  const prisma = {
    $transaction: jest.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
    ),
  } as unknown as PrismaService
  return {
    repository: new AgentOutputFileRepository(prisma),
    transaction,
    prisma,
  }
}

const reservation = {
  id: '00000000-0000-4000-8000-000000000001',
  userId: '00000000-0000-4000-8000-000000000002',
  runId: '00000000-0000-4000-8000-000000000003',
  sandboxPath: '/workspace/output/result.zip',
  name: 'result.zip',
  mimeType: 'application/zip',
  objectKey: 'user-files/user/output/file',
  sizeBytes: 2 * MIB,
  sha256: 'a'.repeat(64),
  maxRunBytes: 100 * MIB,
  maxUserBytes: 1024 * MIB,
}

describe('AgentOutputFileRepository quota reservation', () => {
  it('rejects a reservation that would exceed the per-run output quota', async () => {
    const { repository, transaction } = setup(99n * BigInt(MIB), 99n * BigInt(MIB))

    await expect(repository.reserve(reservation)).rejects.toMatchObject({
      code: 'OUTPUT_RUN_QUOTA_EXCEEDED',
      retryable: false,
    })
    expect(transaction.userFile.create).not.toHaveBeenCalled()
  })

  it('rejects a reservation that would exceed the retained user file quota', async () => {
    const { repository, transaction } = setup(0n, 1023n * BigInt(MIB))

    await expect(repository.reserve(reservation)).rejects.toMatchObject({
      code: 'OUTPUT_USER_QUOTA_EXCEEDED',
      retryable: false,
    })
    expect(transaction.userFile.create).not.toHaveBeenCalled()
  })

  it('retries a serializable transaction conflict instead of bypassing quota checks', async () => {
    const { repository, prisma } = setup(0n, 0n)
    const transaction = prisma.$transaction as jest.Mock
    const execute = transaction.getMockImplementation()
    transaction
      .mockRejectedValueOnce({ code: 'P2034' })
      .mockImplementationOnce(execute as (...args: unknown[]) => unknown)

    await repository.reserve(reservation).catch(() => undefined)

    expect(transaction).toHaveBeenCalledTimes(2)
  })
})
