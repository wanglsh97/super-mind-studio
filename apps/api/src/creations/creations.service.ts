import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common'

import { PrismaService } from '../database/prisma.service'
import { AgentService } from '../agent/agent.service'
import type { AuthenticatedUser } from '../user/user.types'

const WEB_ARTIFACT_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000
const DEFAULT_AGENT_MODEL = 'qwen3.7-plus'

@Injectable()
export class CreationsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AgentService) private readonly agent: AgentService,
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
    return [
      ...websites.map((project) => toCreationItem(project, now)),
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
    return toCreationItem(project, new Date())
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

function toCreationItem(project: any, now: Date) {
  const expired = project.creation.expiresAt !== null && project.creation.expiresAt <= now
  return {
    id: project.creation.id,
    projectId: project.id,
    type: 'website' as const,
    status: expired ? 'expired' : project.status.toLowerCase(),
    title: project.creation.title,
    createdAt: project.creation.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    expiresAt: project.creation.expiresAt?.toISOString() ?? null,
    threadId: project.agentThreadId,
    runId: project.agentRunId,
    assets: project.creation.assets.map((asset: any) => ({
      id: asset.id, kind: asset.kind.toLowerCase(), name: asset.name, expiresAt: asset.expiresAt?.toISOString() ?? null,
    })),
  }
}
