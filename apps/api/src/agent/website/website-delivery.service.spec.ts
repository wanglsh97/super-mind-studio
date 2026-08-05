import { WebsiteDeliveryError, WebsiteDeliveryService } from './website-delivery.service'

const userId = '00000000-0000-4000-8000-000000000001'
const runId = '00000000-0000-4000-8000-000000000002'
const threadId = '00000000-0000-4000-8000-000000000003'
const projectId = '00000000-0000-4000-8000-000000000004'
const creationId = '00000000-0000-4000-8000-000000000005'

describe('WebsiteDeliveryService', () => {
  it('does not upload or switch current artifacts when the fixed build fails', async () => {
    const fixture = setup({ buildExitCode: 1 })

    await expect(fixture.service.deliver(runId, userId)).rejects.toMatchObject({
      code: 'WEBSITE_BUILD_FAILED',
    } satisfies Partial<WebsiteDeliveryError>)

    expect(fixture.objects.writeUserFile).not.toHaveBeenCalled()
    expect(fixture.prisma.$transaction).not.toHaveBeenCalled()
  })

  it('atomically replaces both website ZIP assets and removes old objects after success', async () => {
    const fixture = setup()

    const result = await fixture.service.deliver(runId, userId)

    expect(result).toMatchObject({
      projectId,
      creationId,
      runId,
      previewPath: `/api/v1/agent/runs/${runId}/preview?port=4173`,
      source: { name: 'source.zip' },
      dist: { name: 'dist.zip' },
    })
    expect(fixture.sessions.runShell).toHaveBeenNthCalledWith(
      1,
      runId,
      userId,
      expect.objectContaining({
        command: 'pnpm build -- --base=./',
        workingDirectory: '/workspace/work',
      }),
    )
    expect(fixture.tx.creationAsset.deleteMany).toHaveBeenCalledWith({
      where: { creationId, kind: { in: ['SOURCE_ZIP', 'DIST_ZIP'] } },
    })
    expect(fixture.tx.creationAsset.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ kind: 'SOURCE_ZIP', name: 'source.zip' }),
        expect.objectContaining({ kind: 'DIST_ZIP', name: 'dist.zip' }),
      ]),
    })
    expect(fixture.tx.webProject.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: projectId },
        data: expect.objectContaining({ agentRunId: runId, status: 'SUCCEEDED' }),
      }),
    )
    expect(fixture.objects.deleteObject).toHaveBeenCalledWith('creations/old/source.zip')
    expect(fixture.objects.deleteObject).toHaveBeenCalledWith('creations/old/dist.zip')
  })

  it('cleans newly uploaded objects and keeps database pointers unchanged when switching fails', async () => {
    const fixture = setup({ transactionError: new Error('db unavailable') })

    await expect(fixture.service.deliver(runId, userId)).rejects.toThrow('db unavailable')

    const writtenKeys = fixture.objects.writeUserFile.mock.calls.map(
      ([input]: [{ objectKey: string }]) => input.objectKey,
    )
    expect(writtenKeys).toHaveLength(2)
    for (const objectKey of writtenKeys) {
      expect(fixture.objects.deleteObject).toHaveBeenCalledWith(objectKey)
    }
    expect(fixture.objects.deleteObject).not.toHaveBeenCalledWith('creations/old/source.zip')
  })
})

function setup(options: { buildExitCode?: number; transactionError?: Error } = {}) {
  const sourceBytes = new TextEncoder().encode('source-zip')
  const distBytes = new TextEncoder().encode('dist-zip')
  const packageBytes = new TextEncoder().encode(
    JSON.stringify({
      scripts: { build: 'vite build' },
      dependencies: {
        react: '19.0.0',
        'react-dom': '19.0.0',
        tailwindcss: '4.0.0',
        'lucide-react': '1.0.0',
      },
      devDependencies: { vite: '7.0.0' },
    }),
  )
  const sessions = {
    readFile: jest.fn(async (_runId: string, _userId: string, path: string) => {
      if (path.endsWith('package.json')) return file(path, packageBytes)
      if (path.endsWith('pnpm-lock.yaml')) return file(path, new TextEncoder().encode('lock'))
      if (path.endsWith('dist/index.html')) return file(path, new TextEncoder().encode('<html>'))
      return null
    }),
    runShell: jest
      .fn()
      .mockResolvedValueOnce(commandResult(options.buildExitCode ?? 0))
      .mockResolvedValueOnce(commandResult(0))
      .mockResolvedValueOnce(commandResult(0)),
    readOutputFile: jest.fn(async (_runId: string, _userId: string, path: string) =>
      path.endsWith('source.zip') ? file(path, sourceBytes) : file(path, distBytes),
    ),
  }
  const project = {
    id: projectId,
    creationId,
    creation: {
      id: creationId,
      assets: [
        { kind: 'SOURCE_ZIP', objectKey: 'creations/old/source.zip' },
        { kind: 'DIST_ZIP', objectKey: 'creations/old/dist.zip' },
      ],
    },
  }
  const tx = {
    creationAsset: { deleteMany: jest.fn(), createMany: jest.fn() },
    webProject: { update: jest.fn() },
    creation: { update: jest.fn() },
  }
  const prisma = {
    agentRun: { findFirst: jest.fn().mockResolvedValue({ id: runId, threadId }) },
    webProject: { findFirst: jest.fn().mockResolvedValue(project) },
    $transaction: jest.fn(async (operation: (client: typeof tx) => Promise<void>) => {
      if (options.transactionError) throw options.transactionError
      await operation(tx)
    }),
  }
  const objects = {
    writeUserFile: jest.fn(
      async (input: { objectKey: string; fileName: string; bytes: Uint8Array }) => ({
        metadata: {
          objectKey: input.objectKey,
          kind: 'user-output',
          contentType: 'application/zip',
          sizeBytes: input.bytes.byteLength,
          sha256: 'a'.repeat(64),
          updatedAt: new Date().toISOString(),
        },
        fileName: input.fileName,
        bytes: input.bytes,
      }),
    ),
    deleteObject: jest.fn(),
  }
  const archives = { validateSource: jest.fn(), validateDist: jest.fn() }
  return {
    sessions,
    prisma,
    tx,
    objects,
    service: new WebsiteDeliveryService(
      prisma as never,
      sessions as never,
      archives as never,
      objects as never,
    ),
  }
}

function file(path: string, bytes: Uint8Array) {
  return { path, bytes, sizeBytes: bytes.byteLength, sha256: 'a'.repeat(64) }
}

function commandResult(exitCode: number) {
  return {
    commandId: 'command',
    exitCode,
    durationMs: 1,
    stdout: { content: '', bytes: 0, truncated: false },
    stderr: { content: exitCode === 0 ? '' : 'build error', bytes: 0, truncated: false },
    limitReason: null,
  }
}
