import type { Entry, ZipFile } from 'yauzl'
import { fromBuffer } from 'yauzl'

export interface SkillPackageFile {
  path: string
  bytes: Uint8Array
}

/**
 * Reads file bytes only after SkillPackageReader has accepted the same archive.
 * The reader deliberately keeps bytes ephemeral; callers write them to the Run
 * sandbox and never persist them in PostgreSQL.
 */
export async function readSkillPackageFiles(archive: Uint8Array): Promise<SkillPackageFile[]> {
  const zip = await openZip(Buffer.from(archive))
  try {
    return await readEntries(zip)
  } finally {
    zip.close()
  }
}

function openZip(buffer: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    fromBuffer(buffer, { lazyEntries: true, decodeStrings: true }, (error, zip) => {
      if (error || !zip) reject(error ?? new Error('无法读取 Skill ZIP'))
      else resolve(zip)
    })
  })
}

function readEntries(zip: ZipFile): Promise<SkillPackageFile[]> {
  return new Promise((resolve, reject) => {
    const files: SkillPackageFile[] = []
    const fail = (error: unknown) =>
      reject(error instanceof Error ? error : new Error(String(error)))

    zip.on('error', fail)
    zip.on('entry', (entry: Entry) => {
      if (entry.fileName.endsWith('/')) {
        zip.readEntry()
        return
      }
      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) {
          fail(error ?? new Error(`无法读取 Skill 文件: ${entry.fileName}`))
          return
        }
        const chunks: Buffer[] = []
        stream.on('data', (chunk: Buffer) => chunks.push(chunk))
        stream.on('error', fail)
        stream.on('end', () => {
          files.push({
            path: entry.fileName,
            bytes: Uint8Array.from(Buffer.concat(chunks)),
          })
          zip.readEntry()
        })
      })
    })
    zip.on('end', () => resolve(files))
    zip.readEntry()
  })
}
