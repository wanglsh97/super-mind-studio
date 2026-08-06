import { Inject, Injectable, NotFoundException } from '@nestjs/common'

import { PrismaService } from '../../database/prisma.service'
import { SkillZipInspector } from '../skills/package/skill-zip-inspector'
import {
  SKILL_OBJECT_STORE_PORT,
  type SkillObjectStorePort,
} from '../skills/storage/skill-object-store.port'

const ARCHIVE_CACHE_TTL_MS = 15 * 60 * 1_000
const ARCHIVE_CACHE_MAX_ENTRIES = 8

interface CachedDistArchive {
  sha256: string
  bytes: Uint8Array
  expiresAt: number
}

@Injectable()
export class DistPreviewArchiveService {
  private readonly zip = new SkillZipInspector(undefined, false)
  private readonly cache = new Map<string, CachedDistArchive>()

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SKILL_OBJECT_STORE_PORT) private readonly objects: SkillObjectStorePort,
  ) {}

  async hasCurrentDist(userId: string, runId: string): Promise<boolean> {
    const asset = await this.findCurrentDistAsset(userId, runId)
    return asset !== null
  }

  async readAsset(
    userId: string,
    runId: string,
    relativePath: string,
  ): Promise<{ status: number; contentType: string; body: Uint8Array }> {
    const asset = await this.findCurrentDistAsset(userId, runId)
    if (!asset) throw new NotFoundException('网站预览产物不存在或已过期')

    const archive = await this.loadArchive(asset.id, asset.objectKey, asset.sha256)
    const entryPath = normalizeArchiveEntryPath(relativePath)
    const body = await this.zip.readFile(archive, entryPath)
    if (!body) throw new NotFoundException('网站预览资源不存在')

    return {
      status: 200,
      contentType: contentTypeForPath(entryPath),
      body,
    }
  }

  private async findCurrentDistAsset(userId: string, runId: string) {
    const project = await this.prisma.webProject.findFirst({
      where: {
        userId,
        agentRunId: runId,
        status: 'SUCCEEDED',
      },
      select: { creationId: true },
    })
    if (!project) return null

    const now = new Date()
    return this.prisma.creationAsset.findFirst({
      where: {
        creationId: project.creationId,
        kind: 'DIST_ZIP',
        creation: { userId, status: 'SUCCEEDED' },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { id: true, objectKey: true, sha256: true },
      orderBy: { createdAt: 'desc' },
    })
  }

  private async loadArchive(
    assetId: string,
    objectKey: string,
    sha256: string | null,
  ): Promise<Uint8Array> {
    const cacheKey = sha256 ?? assetId
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now() && (!sha256 || cached.sha256 === sha256)) {
      return cached.bytes
    }

    const stored = await this.objects.loadUserFile(objectKey)
    if (!stored) throw new NotFoundException('网站预览产物不存在或已过期')

    this.cache.set(cacheKey, {
      sha256: sha256 ?? stored.metadata.sha256,
      bytes: stored.bytes,
      expiresAt: Date.now() + ARCHIVE_CACHE_TTL_MS,
    })
    this.trimCache()
    return stored.bytes
  }

  private trimCache(): void {
    while (this.cache.size > ARCHIVE_CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) return
      this.cache.delete(oldest)
    }
  }
}

function normalizeArchiveEntryPath(relativePath: string): string {
  const trimmed = relativePath.replace(/^\/+/, '').replace(/\/+$/, '')
  if (!trimmed || trimmed.endsWith('/')) return 'index.html'
  return trimmed
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment)
      } catch {
        return segment
      }
    })
    .join('/')
}

function contentTypeForPath(path: string): string {
  const extension = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1).toLowerCase() : ''
  switch (extension) {
    case 'html':
    case 'htm':
      return 'text/html; charset=utf-8'
    case 'js':
    case 'mjs':
    case 'cjs':
      return 'text/javascript; charset=utf-8'
    case 'css':
      return 'text/css; charset=utf-8'
    case 'json':
      return 'application/json; charset=utf-8'
    case 'svg':
      return 'image/svg+xml'
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'ico':
      return 'image/x-icon'
    case 'woff':
      return 'font/woff'
    case 'woff2':
      return 'font/woff2'
    case 'ttf':
      return 'font/ttf'
    case 'map':
      return 'application/json; charset=utf-8'
    case 'txt':
      return 'text/plain; charset=utf-8'
    default:
      return 'application/octet-stream'
  }
}
