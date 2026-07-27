import { createHash } from 'node:crypto'

import type { SkillPackageFixture } from './storage/in-memory-skill-object-store'

export const MOCK_EXECUTABLE_SKILL = Object.freeze({
  id: '00000000-0000-4000-8000-00000000a501',
  name: 'mock-data-cleaner',
  title: 'Mock 数据清洗',
  description: '使用确定性脚本清洗输入文本并生成结果文件。',
  category: 'development',
  owner: {
    id: '00000000-0000-4000-8000-00000000a500',
    githubId: 'system-skill-market',
    githubUsername: 'aigateway-skills',
  },
  objectKey: 'skills/mock-data-cleaner/package.zip',
  skillMarkdown:
    '# Mock Data Cleaner\n\nUse Shell to run node scripts/clean.mjs and export the result.',
})

const MOCK_ARCHIVE = Uint8Array.from(
  Buffer.from(
    'UEsDBBQAAAgIADci+1yyYEN2TgAAAFMAAAAIAAAAU0tJTEwubWQVyjEKgDAMBdC9p/jgXg+hq5N4gNAGqtamJCl4fPHNb8Im6cZKTlgqU2MN4TDGXrhWuEBHQ5PMsKRnd5vT3+JzGahl8NtFHV4Yyjaqxw9QSwMEFAAACAgANyL7XKlZomcXAAAAFQAAABEAAABzY3JpcHRzL2NsZWFuLm1qc0vOzyvOz0nVy8lP11BKzklNzFPS5AIAUEsBAj8DFAAACAgANyL7XLJgQ3ZOAAAAUwAAAAgACQAAAAAAAAAAALSBAAAAAFNLSUxMLm1kVVQFAANaPmdqUEsBAj8DFAAACAgANyL7XKlZomcXAAAAFQAAABEACQAAAAAAAAAAALSBdAAAAHNjcmlwdHMvY2xlYW4ubWpzVVQFAANaPmdqUEsFBgAAAAACAAIAhwAAALoAAAAAAA==',
    'base64',
  ),
)

export const MOCK_EXECUTABLE_SKILL_SHA256 = createHash('sha256').update(MOCK_ARCHIVE).digest('hex')

export const MOCK_EXECUTABLE_SKILL_PACKAGE = Object.freeze({
  objectKey: MOCK_EXECUTABLE_SKILL.objectKey,
  archive: MOCK_ARCHIVE,
  skillMarkdown: MOCK_EXECUTABLE_SKILL.skillMarkdown,
  files: [
    { path: 'SKILL.md', type: 'file', size: 83 },
    { path: 'scripts', type: 'directory', size: null },
    { path: 'scripts/clean.mjs', type: 'file', size: 21 },
  ] as const,
  updatedAt: '2000-01-01T00:00:00.000Z',
}) satisfies SkillPackageFixture

export const MOCK_EXECUTABLE_SKILL_DOWNLOAD = Object.freeze({
  metadata: {
    objectKey: MOCK_EXECUTABLE_SKILL.objectKey,
    kind: 'skill-package' as const,
    contentType: 'application/zip',
    sizeBytes: MOCK_ARCHIVE.byteLength,
    sha256: MOCK_EXECUTABLE_SKILL_SHA256,
    updatedAt: '2000-01-01T00:00:00.000Z',
  },
  url: `data:application/zip;base64,${Buffer.from(MOCK_ARCHIVE).toString('base64')}`,
  expiresAt: '2000-01-01T00:01:00.000Z',
})
