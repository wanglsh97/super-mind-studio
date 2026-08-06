import { randomUUID } from 'node:crypto'

import { Inject, Injectable } from '@nestjs/common'

import { PrismaService } from '../../database/prisma.service'
import { WebProjectArchiveValidator } from '../../creations/web-project-archive.validator'
import { AgentExecutionSessionService } from '../sandbox/agent-execution-session.service'
import {
  SKILL_OBJECT_STORE_PORT,
  type SkillObjectStorePort,
} from '../skills/storage/skill-object-store.port'

const PROJECT_ROOT = '/workspace/work'
const OUTPUT_ROOT = '/workspace/output'
const PREVIEW_PORT = 4173
const RETENTION_MS = 30 * 24 * 60 * 60 * 1_000
const REQUIRED_DEPENDENCIES = ['react', 'react-dom', 'vite', 'tailwindcss', 'lucide-react'] as const
const FORBIDDEN_DEPENDENCIES = [
  '@nestjs/core',
  '@prisma/client',
  'better-sqlite3',
  'express',
  'fastify',
  'mysql2',
  'next',
  'pg',
  'prisma',
] as const

export interface WebsiteDeliveryResult {
  projectId: string
  creationId: string
  runId: string
  builtAt: string
  expiresAt: string
  previewPath: string
  source: { id: string; name: 'source.zip'; downloadUrl: string; sizeBytes: number }
  dist: { id: string; name: 'dist.zip'; downloadUrl: string; sizeBytes: number }
}

@Injectable()
export class WebsiteDeliveryService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AgentExecutionSessionService)
    private readonly sessions: AgentExecutionSessionService,
    @Inject(WebProjectArchiveValidator) private readonly archives: WebProjectArchiveValidator,
    @Inject(SKILL_OBJECT_STORE_PORT) private readonly objects: SkillObjectStorePort,
  ) {}

  async deliver(
    runId: string,
    userId: string,
    signal?: AbortSignal,
  ): Promise<WebsiteDeliveryResult> {
    const run = await this.prisma.agentRun.findFirst({
      where: { id: runId, userId },
      select: { id: true, threadId: true },
    })
    if (!run) throw new WebsiteDeliveryError('WEBSITE_PROJECT_INVALID', '网页 Agent 运行不存在')
    const project = await this.prisma.webProject.findFirst({
      where: { userId, agentThreadId: run.threadId },
      include: { creation: { include: { assets: true } } },
    })
    if (!project) {
      throw new WebsiteDeliveryError('WEBSITE_PROJECT_INVALID', '当前 Thread 没有网页项目')
    }

    await this.validateProject(runId, userId, signal)
    const build = await this.sessions.runShell(runId, userId, {
      command: 'pnpm build -- --base=./',
      workingDirectory: PROJECT_ROOT,
      ...(signal === undefined ? {} : { signal }),
    })
    if (build.exitCode !== 0 || build.error) {
      throw new WebsiteDeliveryError(
        'WEBSITE_BUILD_FAILED',
        boundedBuildFailure(build.stdout.content, build.stderr.content, build.error?.message),
      )
    }
    const index = await this.sessions.readFile(
      runId,
      userId,
      `${PROJECT_ROOT}/dist/index.html`,
      signal,
    )
    if (!index || index.sizeBytes === 0) {
      throw new WebsiteDeliveryError(
        'WEBSITE_PROJECT_INVALID',
        '构建成功但 dist/index.html 不存在或为空',
      )
    }

    const packaged = await this.sessions.runShell(runId, userId, {
      command: 'python3 /workspace/.platform-skills/website-building/scripts/package.py',
      workingDirectory: PROJECT_ROOT,
      ...(signal === undefined ? {} : { signal }),
    })
    if (packaged.exitCode !== 0 || packaged.error) {
      throw new WebsiteDeliveryError(
        'WEBSITE_ARCHIVE_FAILED',
        boundedBuildFailure(
          packaged.stdout.content,
          packaged.stderr.content,
          packaged.error?.message,
        ),
      )
    }
    const [source, dist] = await Promise.all([
      this.sessions.readOutputFile(runId, userId, `${OUTPUT_ROOT}/source.zip`, signal),
      this.sessions.readOutputFile(runId, userId, `${OUTPUT_ROOT}/dist.zip`, signal),
    ])
    if (!source || !dist) {
      throw new WebsiteDeliveryError('WEBSITE_ARCHIVE_FAILED', '受控打包未生成完整 ZIP 产物')
    }
    await Promise.all([
      this.archives.validateSource(source.bytes),
      this.archives.validateDist(dist.bytes),
    ])
    await this.ensurePreviewServer(runId, userId, signal)

    const deliveryId = randomUUID()
    const sourceId = randomUUID()
    const distId = randomUUID()
    const sourceKey = `creations/${userId}/${project.creationId}/deliveries/${deliveryId}/source.zip`
    const distKey = `creations/${userId}/${project.creationId}/deliveries/${deliveryId}/dist.zip`
    const newKeys = [sourceKey, distKey]
    let committed = false
    try {
      const [storedSource, storedDist] = await Promise.all([
        this.objects.writeUserFile({
          objectKey: sourceKey,
          direction: 'output',
          fileName: 'source.zip',
          contentType: 'application/zip',
          bytes: source.bytes,
          ...(signal === undefined ? {} : { signal }),
        }),
        this.objects.writeUserFile({
          objectKey: distKey,
          direction: 'output',
          fileName: 'dist.zip',
          contentType: 'application/zip',
          bytes: dist.bytes,
          ...(signal === undefined ? {} : { signal }),
        }),
      ])
      const builtAt = new Date()
      const expiresAt = new Date(builtAt.getTime() + RETENTION_MS)
      const oldKeys = project.creation.assets
        .filter((asset) => asset.kind === 'SOURCE_ZIP' || asset.kind === 'DIST_ZIP')
        .map((asset) => asset.objectKey)
      await this.prisma.$transaction(async (tx) => {
        await tx.creationAsset.deleteMany({
          where: { creationId: project.creationId, kind: { in: ['SOURCE_ZIP', 'DIST_ZIP'] } },
        })
        await tx.creationAsset.createMany({
          data: [
            {
              id: sourceId,
              creationId: project.creationId,
              kind: 'SOURCE_ZIP',
              name: 'source.zip',
              mimeType: storedSource.metadata.contentType,
              objectKey: sourceKey,
              sizeBytes: BigInt(storedSource.metadata.sizeBytes),
              sha256: storedSource.metadata.sha256,
              expiresAt,
            },
            {
              id: distId,
              creationId: project.creationId,
              kind: 'DIST_ZIP',
              name: 'dist.zip',
              mimeType: storedDist.metadata.contentType,
              objectKey: distKey,
              sizeBytes: BigInt(storedDist.metadata.sizeBytes),
              sha256: storedDist.metadata.sha256,
              expiresAt,
            },
          ],
        })
        await tx.webProject.update({
          where: { id: project.id },
          data: {
            agentRunId: runId,
            status: 'SUCCEEDED',
            framework: 'react-vite',
            buildCommand: 'pnpm build -- --base=./',
            outputDir: 'dist',
            errorCode: null,
            errorMessage: null,
          },
        })
        await tx.creation.update({
          where: { id: project.creationId },
          data: { status: 'SUCCEEDED', expiresAt },
        })
      })
      committed = true
      await Promise.allSettled(oldKeys.map((objectKey) => this.objects.deleteObject(objectKey)))

      return {
        projectId: project.id,
        creationId: project.creationId,
        runId,
        builtAt: builtAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        previewPath: `/api/v1/agent/runs/${encodeURIComponent(runId)}/preview?port=${PREVIEW_PORT}`,
        source: {
          id: sourceId,
          name: 'source.zip',
          downloadUrl: `/api/v1/creations/assets/${sourceId}/content`,
          sizeBytes: source.sizeBytes,
        },
        dist: {
          id: distId,
          name: 'dist.zip',
          downloadUrl: `/api/v1/creations/assets/${distId}/content`,
          sizeBytes: dist.sizeBytes,
        },
      }
    } finally {
      if (!committed) {
        await Promise.allSettled(newKeys.map((objectKey) => this.objects.deleteObject(objectKey)))
      }
    }
  }

  private async validateProject(runId: string, userId: string, signal?: AbortSignal) {
    const [packageFile, lockFile] = await Promise.all([
      this.sessions.readFile(runId, userId, `${PROJECT_ROOT}/package.json`, signal),
      this.sessions.readFile(runId, userId, `${PROJECT_ROOT}/pnpm-lock.yaml`, signal),
    ])
    if (!packageFile || !lockFile) {
      throw new WebsiteDeliveryError(
        'WEBSITE_PROJECT_INVALID',
        '项目根目录必须包含 package.json 和 pnpm-lock.yaml',
      )
    }
    let manifest: Record<string, unknown>
    try {
      manifest = JSON.parse(new TextDecoder().decode(packageFile.bytes)) as Record<string, unknown>
    } catch {
      throw new WebsiteDeliveryError('WEBSITE_PROJECT_INVALID', 'package.json 不是有效 JSON')
    }
    const scripts = recordValue(manifest.scripts)
    if (typeof scripts?.build !== 'string' || scripts.build.trim() === '') {
      throw new WebsiteDeliveryError(
        'WEBSITE_PROJECT_INVALID',
        'package.json 必须声明 build script',
      )
    }
    const dependencies = {
      ...recordValue(manifest.dependencies),
      ...recordValue(manifest.devDependencies),
    }
    const missing = REQUIRED_DEPENDENCIES.filter((name) => typeof dependencies[name] !== 'string')
    if (missing.length > 0) {
      throw new WebsiteDeliveryError(
        'WEBSITE_PROJECT_INVALID',
        `项目缺少固定技术栈依赖: ${missing.join(', ')}`,
      )
    }
    const forbidden = FORBIDDEN_DEPENDENCIES.filter(
      (name) => typeof dependencies[name] === 'string',
    )
    if (forbidden.length > 0) {
      throw new WebsiteDeliveryError(
        'WEBSITE_PROJECT_INVALID',
        `静态网站不允许服务端依赖: ${forbidden.join(', ')}`,
      )
    }
  }

  private async ensurePreviewServer(runId: string, userId: string, signal?: AbortSignal) {
    const result = await this.sessions.runShell(runId, userId, {
      command:
        `if [ -f /tmp/supermind-website-preview.pid ]; then kill "$(cat /tmp/supermind-website-preview.pid)" >/dev/null 2>&1 || true; fi; ` +
        `nohup python3 -m http.server ${PREVIEW_PORT} --bind 0.0.0.0 --directory /workspace/work/dist >/tmp/supermind-website-preview.log 2>&1 & ` +
        `preview_pid=$!; echo "$preview_pid" >/tmp/supermind-website-preview.pid; ` +
        `for attempt in 1 2 3 4 5 6 7 8 9 10; do python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:${PREVIEW_PORT}/', timeout=1).read(1)" >/dev/null 2>&1 && exit 0; sleep 0.2; done; ` +
        `cat /tmp/supermind-website-preview.log >&2; exit 1`,
      workingDirectory: PROJECT_ROOT,
      ...(signal === undefined ? {} : { signal }),
    })
    if (result.exitCode !== 0 || result.error) {
      throw new WebsiteDeliveryError(
        'WEBSITE_PREVIEW_FAILED',
        boundedBuildFailure(result.stdout.content, result.stderr.content, result.error?.message),
      )
    }
  }
}

export class WebsiteDeliveryError extends Error {
  readonly retryable = false

  constructor(
    readonly code:
      | 'WEBSITE_PROJECT_INVALID'
      | 'WEBSITE_BUILD_FAILED'
      | 'WEBSITE_ARCHIVE_FAILED'
      | 'WEBSITE_PREVIEW_FAILED',
    message: string,
  ) {
    super(message)
    this.name = 'WebsiteDeliveryError'
  }
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function boundedBuildFailure(stdout: string, stderr: string, error?: string): string {
  const detail = [error, stdout, stderr].filter(Boolean).join('\n').trim()
  return `网站交付失败，请修复后重试：\n${detail.slice(-6_000) || '未返回构建日志'}`
}
