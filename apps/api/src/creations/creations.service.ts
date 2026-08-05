import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common'

import type {
  AgentRun,
  Creation,
  CreationAsset,
  CreationStatus,
  UserFile,
  WebProject,
  WebProjectStatus,
} from '../generated/prisma/client'
import { AgentOutputFileService } from '../agent/files/agent-output-file.service'
import { PrismaService } from '../database/prisma.service'
import { AgentService } from '../agent/agent.service'
import type { AuthenticatedUser } from '../user/user.types'
import { WebProjectArchiveValidationError, WebProjectArchiveValidator } from './web-project-archive.validator'

const WEB_ARTIFACT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000
const DEFAULT_AGENT_MODEL = 'qwen3.7-plus'

@Injectable()
export class CreationsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AgentService) private readonly agent: AgentService,
    @Inject(AgentOutputFileService) private readonly outputFiles: AgentOutputFileService,
    @Inject(WebProjectArchiveValidator) private readonly archives: WebProjectArchiveValidator,
  ) {}

  async createWebsite(user: AuthenticatedUser, input: { prompt: string; model?: string }) {
    this.requireGithub(user)
    const title = deriveTitle(input.prompt)
    const expiresAt = new Date(Date.now() + WEB_ARTIFACT_RETENTION_MS)
    const project = await this.prisma.$transaction(async (tx) => {
      const creation = await tx.creation.create({
        data: { userId: user.id, type: 'WEBSITE', status: 'PENDING', title, expiresAt },
      })
      return tx.webProject.create({
        data: { creationId: creation.id, userId: user.id, status: 'PENDING' },
        include: { creation: true },
      })
    })

    try {
      const thread = await this.agent.createThread(user, {
        model: input.model?.trim() || DEFAULT_AGENT_MODEL,
        title: title || '网页创作',
      })
      const run = await this.agent.createRun(
        user,
        thread.id,
        webGenerationInstruction(input.prompt.trim()),
      )
      const updated = await this.prisma.webProject.update({
        where: { id: project.id },
        data: {
          agentThreadId: thread.id,
          agentRunId: run.id,
          status: 'GENERATING',
          creation: { update: { status: 'RUNNING' } },
        },
        include: { creation: true },
      })
      return toWebsite(updated)
    } catch (error) {
      await this.prisma.webProject.update({
        where: { id: project.id },
        data: {
          status: 'FAILED',
          errorCode: 'WEB_PROJECT_START_FAILED',
          errorMessage: error instanceof Error ? error.message : '无法启动网页生成',
          creation: { update: { status: 'FAILED' } },
        },
      })
      throw error
    }
  }

  async list(user: AuthenticatedUser) {
    this.requireGithub(user)
    const now = new Date()
    const [websites, images] = await Promise.all([
      this.prisma.webProject.findMany({
        where: { userId: user.id },
        include: { creation: { include: { assets: { orderBy: { createdAt: 'asc' } } } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.imageGenerationTask.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        select: { taskId: true, prompt: true, status: true, createdAt: true, updatedAt: true, results: true },
      }),
    ])
    const outputs = await this.findWebsiteOutputs(user.id, websites)
    const statuses = await this.syncTerminalProjectStatuses(websites, outputs)
    return [
      ...websites.map((project) => toCreationItem(project, now, outputs.get(project.agentRunId ?? '') ?? [], statuses.get(project.id))),
      ...images.map((image) => ({
        id: `image:${image.taskId}`,
        type: 'image' as const,
        status: image.status.toLowerCase(),
        title: image.prompt.slice(0, 80) || '图片创作',
        createdAt: image.createdAt.toISOString(),
        updatedAt: image.updatedAt.toISOString(),
        imageTaskId: image.taskId,
        imageCount: Array.isArray(image.results) ? image.results.length : 0,
        expiresAt: null,
      })),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async getWebsite(user: AuthenticatedUser, projectId: string) {
    this.requireGithub(user)
    const project = await this.prisma.webProject.findFirst({
      where: { id: projectId, userId: user.id },
      include: { creation: { include: { assets: true } } },
    })
    if (!project) throw new NotFoundException('网页项目不存在')
    const outputs = await this.findWebsiteOutputs(user.id, [project])
    const statuses = await this.syncTerminalProjectStatuses([project], outputs)
    return toCreationItem(project, new Date(), outputs.get(project.agentRunId ?? '') ?? [], statuses.get(project.id))
  }

  async downloadWebsiteAsset(user: AuthenticatedUser, projectId: string, kind: string) {
    this.requireGithub(user)
    const fileName = websiteAssetFileName(kind)
    const project = await this.prisma.webProject.findFirst({
      where: { id: projectId, userId: user.id },
      include: { creation: true },
    })
    if (!project || !project.agentRunId || isExpired(project.creation.expiresAt, new Date())) {
      throw new NotFoundException('网页产物不存在或已过期')
    }
    const file = await this.prisma.userFile.findFirst({
      where: {
        userId: user.id,
        runId: project.agentRunId,
        direction: 'OUTPUT',
        status: 'AVAILABLE',
        name: fileName,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    if (!file) throw new NotFoundException('网页产物尚未生成')
    return this.outputFiles.loadForOwner(file.id, user.id)
  }

  private async findWebsiteOutputs(userId: string, projects: readonly WebsiteProject[]): Promise<Map<string, WebsiteOutput[]>> {
    const runIds = projects.flatMap((project) => project.agentRunId === null ? [] : [project.agentRunId])
    if (runIds.length === 0) return new Map()
    const files = await this.prisma.userFile.findMany({
      where: { userId, runId: { in: runIds }, direction: 'OUTPUT', status: 'AVAILABLE', name: { in: ['source.zip', 'dist.zip'] } },
      select: { id: true, runId: true, name: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })
    return files.reduce((outputs, file) => {
      if (file.runId === null) return outputs
      const existing = outputs.get(file.runId) ?? []
      existing.push(file)
      outputs.set(file.runId, existing)
      return outputs
    }, new Map<string, WebsiteOutput[]>())
  }

  /**
   * AgentRun 是执行真源；网页项目只在读取时把已经终结的 run 收敛一次，避免新增 worker。
   * 成功 run 必须同时导出 source.zip 与 dist.zip，否则静态交付不完整，项目明确失败。
   */
  private async syncTerminalProjectStatuses(
    projects: readonly WebsiteProject[],
    outputs: ReadonlyMap<string, readonly WebsiteOutput[]>,
  ): Promise<Map<string, WebProjectStatus>> {
    const runIds = projects.flatMap((project) => project.agentRunId === null ? [] : [project.agentRunId])
    if (runIds.length === 0) return new Map()
    const runs = await this.prisma.agentRun.findMany({
      where: { id: { in: runIds } },
      select: { id: true, status: true, errorCode: true, errorMessage: true },
    })
    const byRunId = new Map(runs.map((run) => [run.id, run]))
    const resolved = new Map<string, WebProjectStatus>()
    await Promise.all(projects.map(async (project) => {
      if (project.agentRunId === null) return
      let transition = resolveTerminalProjectStatus(project, byRunId.get(project.agentRunId), outputs.get(project.agentRunId) ?? [])
      if (transition === null) return
      if (transition.status === 'SUCCEEDED') {
        transition = await this.validateCompletedProject(project, outputs.get(project.agentRunId) ?? [])
      }
      resolved.set(project.id, transition.status)
      if (project.status === transition.status) return
      await this.prisma.webProject.update({
        where: { id: project.id },
        data: {
          status: transition.status,
          errorCode: transition.errorCode,
          errorMessage: transition.errorMessage,
          creation: { update: { status: transition.creationStatus } },
        },
      })
    }))
    return resolved
  }

  private async validateCompletedProject(
    project: WebsiteProject,
    outputs: readonly WebsiteOutput[],
  ): Promise<ProjectTransition> {
    const source = outputs.find((output) => output.name === 'source.zip')
    const dist = outputs.find((output) => output.name === 'dist.zip')
    if (!source || !dist) return missingArtifactsTransition()
    try {
      const [sourceFile, distFile] = await Promise.all([
        this.outputFiles.loadForOwner(source.id, project.userId),
        this.outputFiles.loadForOwner(dist.id, project.userId),
      ])
      await this.archives.validateSource(sourceFile.stored.bytes)
      await this.archives.validateDist(distFile.stored.bytes)
      return { status: 'SUCCEEDED', creationStatus: 'SUCCEEDED', errorCode: null, errorMessage: null }
    } catch (error) {
      const message = error instanceof Error ? error.message : '网页 ZIP 校验失败'
      return {
        status: 'FAILED',
        creationStatus: 'FAILED',
        errorCode: error instanceof WebProjectArchiveValidationError ? error.code : 'WEB_PROJECT_ARCHIVE_UNAVAILABLE',
        errorMessage: message,
      }
    }
  }

  private requireGithub(user: AuthenticatedUser) {
    if (user.authProvider !== 'GITHUB') {
      throw new ForbiddenException({
        code: 'GITHUB_LOGIN_REQUIRED',
        message: '网页创作仅支持使用 GitHub 账号登录',
        retryable: false,
      })
    }
  }
}

function deriveTitle(prompt: string) {
  return prompt.replace(/\s+/g, ' ').trim().slice(0, 80) || '网页创作'
}

function webGenerationInstruction(request: string) {
  return `Create a complete static website for the following request:\n\n${request}\n\nThis is a static-site delivery task. Select an appropriate frontend stack, but do not implement a database, authentication, payment, server runtime, private environment variables, or private API keys. Work under /workspace/work. Produce a package.json, a lockfile, and a repeatable build command that creates a static dist directory. Validate the build. Then create source.zip (excluding node_modules and secrets) and dist.zip under /workspace/output, and call export_file for both artifacts. Clearly report build failures instead of claiming completion.`
}

function toWebsite(project: { id: string; status: string; agentThreadId: string | null; agentRunId: string | null; creation: { id: string; title: string; expiresAt: Date | null; createdAt: Date } }) {
  return {
    id: project.id,
    creationId: project.creation.id,
    status: project.status.toLowerCase(),
    title: project.creation.title,
    threadId: project.agentThreadId,
    runId: project.agentRunId,
    expiresAt: project.creation.expiresAt?.toISOString() ?? null,
    createdAt: project.creation.createdAt.toISOString(),
  }
}

type WebsiteProject = WebProject & { creation: Creation & { assets: CreationAsset[] } }
type WebsiteOutput = Pick<UserFile, 'id' | 'runId' | 'name' | 'createdAt'>

function toCreationItem(
  project: WebsiteProject,
  now: Date,
  outputs: readonly WebsiteOutput[],
  synchronizedStatus?: WebProjectStatus,
) {
  const expired = isExpired(project.creation.expiresAt, now)
  const storedAssets = project.creation.assets.map((asset) => ({
    id: asset.id, kind: asset.kind.toLowerCase(), name: asset.name, expiresAt: asset.expiresAt?.toISOString() ?? null,
  }))
  const exportedAssets = expired ? [] : outputs.map((file) => ({
    id: file.id,
    kind: file.name === 'source.zip' ? 'source_zip' : 'dist_zip',
    name: file.name,
    expiresAt: project.creation.expiresAt?.toISOString() ?? null,
    downloadUrl: `/api/v1/creations/websites/${project.id}/assets/${file.name === 'source.zip' ? 'source' : 'dist'}`,
  }))
  return {
    id: project.creation.id,
    projectId: project.id,
    type: 'website' as const,
    status: expired ? 'expired' : (synchronizedStatus ?? project.status).toLowerCase(),
    title: project.creation.title,
    createdAt: project.creation.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    expiresAt: project.creation.expiresAt?.toISOString() ?? null,
    threadId: project.agentThreadId,
    runId: project.agentRunId,
    assets: [...storedAssets, ...exportedAssets],
  }
}

type ProjectTransition = { status: WebProjectStatus; creationStatus: CreationStatus; errorCode: string | null; errorMessage: string | null }

function resolveTerminalProjectStatus(
  project: WebsiteProject,
  run: Pick<AgentRun, 'status' | 'errorCode' | 'errorMessage'> | undefined,
  outputs: readonly WebsiteOutput[],
): ProjectTransition | null {
  if (run === undefined || ['RUNNING', 'CANCELLING', 'WAITING_FOR_USER'].includes(run.status)) return null
  if (run.status === 'SUCCEEDED') {
    const names = new Set(outputs.map((output) => output.name))
    if (names.has('source.zip') && names.has('dist.zip')) {
      return { status: 'SUCCEEDED', creationStatus: 'SUCCEEDED', errorCode: null, errorMessage: null }
    }
    return missingArtifactsTransition()
  }
  return {
    status: 'FAILED',
    creationStatus: 'FAILED',
    errorCode: run.errorCode ?? `AGENT_RUN_${run.status}`,
    errorMessage: run.errorMessage ?? '网页生成未完成',
  }
}

function missingArtifactsTransition(): ProjectTransition {
  return {
    status: 'FAILED',
    creationStatus: 'FAILED',
    errorCode: 'WEB_PROJECT_ARTIFACTS_MISSING',
    errorMessage: 'Agent 已结束，但未导出完整的 source.zip 和 dist.zip',
  }
}

function websiteAssetFileName(kind: string): 'source.zip' | 'dist.zip' {
  if (kind === 'source') return 'source.zip'
  if (kind === 'dist') return 'dist.zip'
  throw new NotFoundException('网页产物不存在')
}

function isExpired(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && expiresAt <= now
}
