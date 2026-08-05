import { ZipFile } from 'yazl'

import type { PrismaService } from '../database/prisma.service'
import type { SkillObjectStorePort } from '../agent/skills/storage/skill-object-store.port'
import type { AuthenticatedUser } from '../user/user.types'
import { WebProjectPreviewService } from './web-project-preview.service'

const user: AuthenticatedUser = { id: '00000000-0000-4000-8000-000000000001', authProvider: 'GITHUB', userName: 'octocat', avatarUrl: null }

describe('WebProjectPreviewService', () => {
  it('extracts an owner-scoped static entry from the archived dist ZIP', async () => {
    const archive = await zip([['index.html', '<h1>Preview</h1>'], ['assets/site.css', 'body{}']])
    const { service, objects } = setup({ creation: { assets: [{ objectKey: 'creations/u/c/dist.zip' }] } })
    objects.loadUserFile.mockResolvedValue({ bytes: archive })

    await expect(service.load(user, crypto.randomUUID())).resolves.toMatchObject({
      bytes: new TextEncoder().encode('<h1>Preview</h1>'),
      contentType: 'text/html; charset=utf-8',
    })
    await expect(service.load(user, crypto.randomUUID(), 'assets/site.css')).resolves.toMatchObject({ contentType: 'text/css; charset=utf-8' })
  })

  it('does not expose missing, expired, or unsafe preview paths', async () => {
    const absent = setup(null).service
    await expect(absent.load(user, crypto.randomUUID())).rejects.toMatchObject({ status: 404 })
    const { service } = setup({ creation: { assets: [{ objectKey: 'creations/u/c/dist.zip' }] } })
    await expect(service.load(user, crypto.randomUUID(), '../secret')).rejects.toMatchObject({ status: 404 })
  })
})

function setup(project: unknown) {
  const findFirst = jest.fn().mockResolvedValue(project)
  const loadUserFile = jest.fn()
  return {
    objects: { loadUserFile },
    service: new WebProjectPreviewService(
      { webProject: { findFirst } } as unknown as PrismaService,
      { loadUserFile } as unknown as SkillObjectStorePort,
    ),
  }
}

async function zip(files: Array<[path: string, content: string]>): Promise<Buffer> {
  const archive = new ZipFile()
  for (const [path, content] of files) archive.addBuffer(Buffer.from(content), path)
  archive.end()
  const chunks: Buffer[] = []
  for await (const chunk of archive.outputStream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}
