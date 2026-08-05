import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { fromBuffer } from 'yauzl'
import type { Entry, ZipFile } from 'yauzl'

import { SKILL_OBJECT_STORE_PORT, type SkillObjectStorePort } from '../agent/skills/storage/skill-object-store.port'
import { PrismaService } from '../database/prisma.service'
import type { AuthenticatedUser } from '../user/user.types'

@Injectable()
export class WebProjectPreviewService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SKILL_OBJECT_STORE_PORT) private readonly objects: SkillObjectStorePort,
  ) {}

  async load(user: AuthenticatedUser, projectId: string, requestedPath = 'index.html') {
    const path = normalizePreviewPath(requestedPath)
    const project = await this.prisma.webProject.findFirst({
      where: { id: projectId, userId: user.id, status: 'SUCCEEDED', creation: { expiresAt: { gt: new Date() } } },
      include: { creation: { include: { assets: { where: { kind: 'DIST_ZIP' } } } } },
    })
    const asset = project?.creation.assets[0]
    if (!asset) throw new NotFoundException('网页预览不存在或已过期')
    const archive = await this.objects.loadUserFile(asset.objectKey)
    if (!archive) throw new NotFoundException('网页预览归档不存在')
    const bytes = await readZipEntry(archive.bytes, path)
    if (bytes === null) throw new NotFoundException('预览文件不存在')
    return { bytes, contentType: contentTypeFor(path) }
  }
}

function normalizePreviewPath(value: string): string {
  const path = value.replace(/^\/+/, '') || 'index.html'
  if (path.includes('\\') || path.includes('\0') || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new NotFoundException('预览文件不存在')
  }
  return path
}

async function readZipEntry(archive: Uint8Array, path: string): Promise<Uint8Array | null> {
  const zip = await new Promise<ZipFile>((resolve, reject) => fromBuffer(Buffer.from(archive), { lazyEntries: true, autoClose: false, validateEntrySizes: true, strictFileNames: true }, (error, value) => error || !value ? reject(error ?? new Error('ZIP 无法打开')) : resolve(value)))
  return new Promise((resolve, reject) => {
    const close = () => zip.close()
    zip.on('error', (error) => { close(); reject(error) })
    zip.on('entry', (entry: Entry) => {
      if (entry.fileName !== path || entry.fileName.endsWith('/')) { zip.readEntry(); return }
      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) { close(); reject(error ?? new Error('ZIP 文件无法读取')); return }
        const chunks: Buffer[] = []
        stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
        stream.on('error', (cause) => { close(); reject(cause) })
        stream.on('end', () => { close(); resolve(Uint8Array.from(Buffer.concat(chunks))) })
      })
    })
    zip.on('end', () => { close(); resolve(null) })
    zip.readEntry()
  })
}

function contentTypeFor(path: string): string {
  const extension = path.split('.').at(-1)?.toLowerCase()
  return ({ html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', woff2: 'font/woff2' } as Record<string, string>)[extension ?? ''] ?? 'application/octet-stream'
}
