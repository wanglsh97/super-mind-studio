import { ZipFile } from 'yazl'

import { WebProjectArchiveValidator } from './web-project-archive.validator'

describe('WebProjectArchiveValidator', () => {
  const validator = new WebProjectArchiveValidator()

  it('accepts a source ZIP with a package manifest and lockfile', async () => {
    await expect(validator.validateSource(await zip([['package.json', '{}'], ['pnpm-lock.yaml', 'lockfileVersion: 9']]))).resolves.toBeUndefined()
  })

  it('rejects source archives without a package manifest or lockfile', async () => {
    await expect(validator.validateSource(await zip([['pnpm-lock.yaml', 'x']]))).rejects.toMatchObject({ code: 'WEB_PROJECT_PACKAGE_MISSING' })
    await expect(validator.validateSource(await zip([['package.json', '{}']]))).rejects.toMatchObject({ code: 'WEB_PROJECT_LOCKFILE_MISSING' })
  })

  it('requires a root static entrypoint for the build ZIP', async () => {
    await expect(validator.validateDist(await zip([['assets/app.js', 'x']]))).rejects.toMatchObject({ code: 'WEB_PROJECT_STATIC_ENTRY_MISSING' })
    await expect(validator.validateDist(await zip([['index.html', '<main/>']]))).resolves.toBeUndefined()
  })
})

async function zip(files: Array<[path: string, content: string]>): Promise<Buffer> {
  const archive = new ZipFile()
  for (const [path, content] of files) archive.addBuffer(Buffer.from(content), path)
  archive.end()
  const chunks: Buffer[] = []
  for await (const chunk of archive.outputStream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}
