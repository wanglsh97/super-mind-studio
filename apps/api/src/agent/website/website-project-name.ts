const FALLBACK_PROJECT_NAME = 'website'
const MAX_ARCHIVE_BASENAME_LENGTH = 120
const GENERIC_PROJECT_NAMES = new Set(['app', 'vite-project', 'work'])

export function readWebsiteProjectName(manifest: Record<string, unknown>): string {
  const name = typeof manifest.name === 'string' ? manifest.name.trim() : ''
  if (name === '') {
    throw new Error('package.json 必须声明非空 name')
  }
  if (GENERIC_PROJECT_NAMES.has(name.toLowerCase())) {
    throw new Error(`package.json.name 不能保留脚手架默认项目名: ${name}`)
  }
  return name
}

export function toWebsiteArchiveBasename(projectName: string): string {
  const normalized = replaceUnsafeFilenameCharacters(projectName.normalize('NFKC'))
    .replace(/^@/, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, MAX_ARCHIVE_BASENAME_LENGTH)
    .replace(/[.-]+$/g, '')

  return normalized || FALLBACK_PROJECT_NAME
}

function replaceUnsafeFilenameCharacters(value: string): string {
  return [...value]
    .map((character) =>
      character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character) ? '-' : character,
    )
    .join('')
}
