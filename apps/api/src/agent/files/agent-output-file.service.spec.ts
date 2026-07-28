import { createHash } from 'node:crypto'

import type { UserFile } from '../../generated/prisma/client'
import type { AgentExecutionSessionService } from '../sandbox/agent-execution-session.service'
import { InMemorySkillObjectStore } from '../skills/storage/in-memory-skill-object-store'
import {
  AgentOutputFileError,
  type AgentOutputFileRepository,
} from './agent-output-file.repository'
import { AgentOutputFileService, normalizeOutputPath } from './agent-output-file.service'

const runId = '00000000-0000-4000-8000-000000000001'
const userId = '00000000-0000-4000-8000-000000000002'
const fileId = '00000000-0000-4000-8000-000000000003'
const bytes = new TextEncoder().encode('<svg/>')
const sha256 = createHash('sha256').update(bytes).digest('hex')

function setup() {
  let record: UserFile | null = null
  const repository = {
    findOutput: jest.fn(async () => record),
    reserve: jest.fn(async (input: Record<string, unknown>) => {
      record = userFile({
        id: String(input.id),
        objectKey: String(input.objectKey),
        sandboxPath: String(input.sandboxPath),
      })
      return record
    }),
    markAvailable: jest.fn(async () => {
      record = { ...record!, status: 'AVAILABLE' }
      return record
    }),
    releaseReservation: jest.fn(async () => {
      record = null
    }),
    findAvailableForOwner: jest.fn(async () => record),
  } as unknown as AgentOutputFileRepository
  const sessions = {
    readOutputFile: jest.fn(async () => ({
      path: '/workspace/output/logo.svg',
      sizeBytes: bytes.byteLength,
      sha256,
      bytes,
    })),
  } as unknown as AgentExecutionSessionService
  const objects = new InMemorySkillObjectStore({
    now: () => new Date('2026-07-27T00:00:00.000Z'),
  })
  return {
    repository,
    sessions,
    objects,
    service: new AgentOutputFileService(repository, sessions, objects),
  }
}

describe('AgentOutputFileService', () => {
  it('exports one /workspace/output artifact to private object storage and returns stable URLs', async () => {
    const { service, repository, objects } = setup()
    const result = await service.export(runId, userId, 'logo.svg')

    expect(result).toMatchObject({
      name: 'logo.svg',
      mimeType: 'image/svg+xml',
      sizeBytes: bytes.byteLength,
      sha256,
      path: '/workspace/output/logo.svg',
    })
    expect(result.contentUrl).toMatch(/^\/api\/v1\/agent\/files\/.+\/content$/)
    expect(result.downloadUrl).toBe(`${result.contentUrl}?download=1`)
    expect(repository.reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        runId,
        sandboxPath: '/workspace/output/logo.svg',
        mimeType: 'image/svg+xml',
      }),
    )
    const stored = await objects.loadUserFile(
      (repository.reserve as jest.Mock).mock.calls[0]?.[0].objectKey,
    )
    expect(stored?.bytes).toEqual(bytes)
  })

  it('reuses an available export without reading or uploading the sandbox file again', async () => {
    const { service, repository, sessions } = setup()
    ;(repository.findOutput as jest.Mock).mockResolvedValue(
      userFile({ id: fileId, status: 'AVAILABLE' }),
    )

    await expect(
      service.export(runId, userId, '/workspace/output/logo.svg'),
    ).resolves.toMatchObject({ id: fileId })
    expect(sessions.readOutputFile).not.toHaveBeenCalled()
    expect(repository.reserve).not.toHaveBeenCalled()
  })

  it('rejects paths outside the explicit output boundary', async () => {
    const { service, sessions } = setup()
    await expect(service.export(runId, userId, '/workspace/work/logo.svg')).rejects.toMatchObject({
      code: 'OUTPUT_FILE_INVALID',
    })
    await expect(service.export(runId, userId, '../secret')).rejects.toBeInstanceOf(
      AgentOutputFileError,
    )
    expect(sessions.readOutputFile).not.toHaveBeenCalled()
  })

  it('loads only an available owner-scoped file', async () => {
    const { service, repository, objects } = setup()
    const record = userFile({ id: fileId, status: 'AVAILABLE' })
    ;(repository.findAvailableForOwner as jest.Mock).mockResolvedValue(record)
    await objects.writeUserFile({
      objectKey: record.objectKey,
      direction: 'output',
      fileName: record.name,
      contentType: record.mimeType!,
      bytes,
    })

    await expect(service.loadForOwner(fileId, userId)).resolves.toMatchObject({
      record: { id: fileId },
      stored: { fileName: 'logo.svg' },
    })
    ;(repository.findAvailableForOwner as jest.Mock).mockResolvedValue(null)
    await expect(service.loadForOwner(fileId, 'other-user')).rejects.toMatchObject({
      code: 'OUTPUT_FILE_NOT_FOUND',
    })
  })
})

describe('normalizeOutputPath', () => {
  it.each([
    ['logo.svg', '/workspace/output/logo.svg'],
    ['output/logo.svg', '/workspace/output/logo.svg'],
    ['/workspace/output/nested/logo.svg', '/workspace/output/nested/logo.svg'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeOutputPath(input)).toBe(expected)
  })
})

function userFile(overrides: Partial<UserFile> = {}): UserFile {
  return {
    id: fileId,
    userId,
    runId,
    sourceToolCallId: null,
    sandboxPath: '/workspace/output/logo.svg',
    direction: 'OUTPUT',
    status: 'PENDING_UPLOAD',
    name: 'logo.svg',
    mimeType: 'image/svg+xml',
    objectKey: `user-files/${userId}/output/${fileId}/logo.svg`,
    sizeBytes: BigInt(bytes.byteLength),
    sha256,
    deletedAt: null,
    createdAt: new Date('2026-07-27T00:00:00.000Z'),
    updatedAt: new Date('2026-07-27T00:00:00.000Z'),
    ...overrides,
  }
}
