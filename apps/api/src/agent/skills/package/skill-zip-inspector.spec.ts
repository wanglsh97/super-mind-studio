import { ZipFile } from 'yazl'

import {
  DEFAULT_SKILL_ZIP_LIMITS,
  inspectEntry,
  SkillZipInspectionError,
  SkillZipInspector,
} from './skill-zip-inspector'

import type { SkillZipLimits } from './skill-zip-inspector'

describe('SkillZipInspector', () => {
  it('accepts a traditional package with root SKILL.md and returns a sorted safe tree', async () => {
    const archive = await zip([
      ['scripts/clean.mjs', 'console.log("ok")'],
      ['SKILL.md', '# Cleaner'],
    ])
    await expect(new SkillZipInspector().inspect(archive)).resolves.toMatchObject({
      compressedSizeBytes: archive.byteLength,
      expandedSizeBytes: 26,
      fileCount: 2,
      files: [
        { path: 'scripts/clean.mjs', type: 'file', size: 17 },
        { path: 'SKILL.md', type: 'file', size: 9 },
      ],
    })
  })

  it('reads one bounded file without extracting the archive', async () => {
    const archive = await zip([
      ['SKILL.md', '# Cleaner'],
      ['package.json', '{"name":"cleaner"}'],
    ])
    const inspector = new SkillZipInspector()

    await expect(inspector.readFile(archive, 'package.json')).resolves.toEqual(
      Buffer.from('{"name":"cleaner"}'),
    )
    await expect(inspector.readFile(archive, 'missing.json')).resolves.toBeNull()
  })

  it('requires a case-sensitive root SKILL.md', async () => {
    await expect(
      new SkillZipInspector().inspect(await zip([['nested/SKILL.md', '# nested']])),
    ).rejects.toMatchObject({ code: 'ZIP_SKILL_MD_MISSING' })
    await expect(
      new SkillZipInspector().inspect(await zip([['skill.md', '# lower']])),
    ).rejects.toMatchObject({ code: 'ZIP_SKILL_MD_MISSING' })
  })

  it('enforces compressed, expanded, file-count, single-file and depth budgets', async () => {
    const basic = await zip([['SKILL.md', '# x']])
    await expect(
      new SkillZipInspector(limits({ maxCompressedBytes: basic.byteLength - 1 })).inspect(basic),
    ).rejects.toMatchObject({ code: 'ZIP_COMPRESSED_SIZE_LIMIT' })

    const twoFiles = await zip([
      ['SKILL.md', '1234'],
      ['a.txt', '5678'],
    ])
    await expect(
      new SkillZipInspector(limits({ maxExpandedBytes: 7 })).inspect(twoFiles),
    ).rejects.toMatchObject({ code: 'ZIP_EXPANDED_SIZE_LIMIT' })
    await expect(
      new SkillZipInspector(limits({ maxEntries: 1 })).inspect(twoFiles),
    ).rejects.toMatchObject({ code: 'ZIP_ENTRY_LIMIT' })
    await expect(
      new SkillZipInspector(limits({ maxFileBytes: 2 })).inspect(basic),
    ).rejects.toMatchObject({ code: 'ZIP_FILE_SIZE_LIMIT' })
    await expect(
      new SkillZipInspector(limits({ maxDirectoryDepth: 1 })).inspect(
        await zip([
          ['SKILL.md', '# x'],
          ['one/two/file.txt', 'x'],
        ]),
      ),
    ).rejects.toMatchObject({ code: 'ZIP_DIRECTORY_DEPTH_LIMIT' })
  })

  it('rejects symbolic links, hard-link metadata, unsafe paths and duplicate local headers', () => {
    expect(() => inspectEntry(fakeEntry({ externalFileAttributes: 0o120777 << 16 }))).toThrow(
      expect.objectContaining({ code: 'ZIP_LINK_NOT_ALLOWED' }),
    )
    expect(() =>
      inspectEntry(fakeEntry({ extraFields: [{ id: 0x756e, data: Buffer.alloc(16) }] })),
    ).toThrow(expect.objectContaining({ code: 'ZIP_LINK_NOT_ALLOWED' }))
    expect(() => inspectEntry(fakeEntry({ fileName: '../escape' }))).toThrow(
      expect.objectContaining({ code: 'ZIP_PATH_INVALID' }),
    )
    const offsets = new Set<number>()
    inspectEntry(fakeEntry(), DEFAULT_SKILL_ZIP_LIMITS, new Set(), offsets)
    expect(() =>
      inspectEntry(
        fakeEntry({ fileName: 'other.txt' }),
        DEFAULT_SKILL_ZIP_LIMITS,
        new Set(),
        offsets,
      ),
    ).toThrow(expect.objectContaining({ code: 'ZIP_LINK_NOT_ALLOWED' }))
  })

  it('rejects malformed non-ZIP bytes with a normalized error', async () => {
    await expect(new SkillZipInspector().inspect(Uint8Array.of(1, 2, 3))).rejects.toBeInstanceOf(
      SkillZipInspectionError,
    )
  })
})

function limits(overrides: Partial<SkillZipLimits>): SkillZipLimits {
  return { ...DEFAULT_SKILL_ZIP_LIMITS, ...overrides }
}

function fakeEntry(overrides: Record<string, unknown> = {}) {
  return {
    fileName: 'SKILL.md',
    uncompressedSize: 1,
    externalFileAttributes: 0o100644 << 16,
    versionMadeBy: 3 << 8,
    relativeOffsetOfLocalHeader: 42,
    extraFields: [],
    isEncrypted: () => false,
    ...overrides,
  } as never
}

async function zip(files: Array<[path: string, content: string]>): Promise<Buffer> {
  const archive = new ZipFile()
  for (const [path, content] of files) archive.addBuffer(Buffer.from(content), path)
  archive.end()
  const chunks: Buffer[] = []
  for await (const chunk of archive.outputStream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}
