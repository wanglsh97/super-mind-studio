import { ZipFile } from 'yazl'

import { DistPreviewArchiveService } from './dist-preview-archive.service'

describe('DistPreviewArchiveService', () => {
  it('serves index.html and nested assets from the current DIST_ZIP', async () => {
    const archive = await zip([
      ['index.html', '<!doctype html><title>demo</title>'],
      ['assets/app.js', 'console.log(1)'],
    ])
    const prisma = {
      webProject: {
        findFirst: jest.fn().mockResolvedValue({ creationId: 'creation-1' }),
      },
      creationAsset: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'asset-1',
          objectKey: 'creations/u/c/dist.zip',
          sha256: 'a'.repeat(64),
        }),
      },
    }
    const objects = {
      loadUserFile: jest.fn().mockResolvedValue({
        metadata: { sha256: 'a'.repeat(64) },
        bytes: archive,
      }),
    }
    const service = new DistPreviewArchiveService(prisma as never, objects as never)

    await expect(service.hasCurrentDist('user-a', 'run-1')).resolves.toBe(true)
    await expect(service.readAsset('user-a', 'run-1', 'index.html')).resolves.toMatchObject({
      status: 200,
      contentType: 'text/html; charset=utf-8',
    })
    await expect(service.readAsset('user-a', 'run-1', 'assets/app.js')).resolves.toMatchObject({
      status: 200,
      contentType: 'text/javascript; charset=utf-8',
    })
    expect(objects.loadUserFile).toHaveBeenCalledTimes(1)
  })

  it('rejects missing current deliveries', async () => {
    const prisma = {
      webProject: { findFirst: jest.fn().mockResolvedValue(null) },
      creationAsset: { findFirst: jest.fn() },
    }
    const objects = { loadUserFile: jest.fn() }
    const service = new DistPreviewArchiveService(prisma as never, objects as never)

    await expect(service.hasCurrentDist('user-a', 'run-1')).resolves.toBe(false)
    await expect(service.readAsset('user-a', 'run-1', 'index.html')).rejects.toMatchObject({
      status: 404,
    })
    expect(objects.loadUserFile).not.toHaveBeenCalled()
  })
})

async function zip(entries: Array<[string, string]>): Promise<Uint8Array> {
  const archive = new ZipFile()
  for (const [path, content] of entries) {
    archive.addBuffer(Buffer.from(content), path)
  }
  archive.end()
  const chunks: Buffer[] = []
  for await (const chunk of archive.outputStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return new Uint8Array(Buffer.concat(chunks))
}
