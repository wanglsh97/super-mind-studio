import { ForbiddenException, NotFoundException } from '@nestjs/common'

import type { AgentOutputFileService } from '../agent/files/agent-output-file.service'
import type { AgentService } from '../agent/agent.service'
import type { PrismaService } from '../database/prisma.service'
import type { AuthenticatedUser } from '../user/user.types'
import { CreationsService } from './creations.service'
import { WebProjectArchiveValidator } from './web-project-archive.validator'

const githubUser: AuthenticatedUser = {
  id: '00000000-0000-4000-8000-000000000001',
  authProvider: 'GITHUB',
  userName: 'octocat',
  avatarUrl: null,
}

describe('CreationsService', () => {
  it('rejects website artifact access for non-GitHub users before querying storage', async () => {
    const { service, prisma } = setup()

    await expect(service.downloadWebsiteAsset({ ...githubUser, authProvider: 'ANONYMOUS' }, crypto.randomUUID(), 'dist')).rejects.toBeInstanceOf(ForbiddenException)
    expect(prisma.webProject.findFirst).not.toHaveBeenCalled()
  })

  it('loads only the current GitHub owner\'s available dist artifact', async () => {
    const { service, prisma, outputs } = setup()
    const projectId = crypto.randomUUID()
    const runId = crypto.randomUUID()
    prisma.webProject.findFirst.mockResolvedValue({
      id: projectId,
      userId: githubUser.id,
      agentRunId: runId,
      creation: { expiresAt: new Date('2026-09-04T00:00:00.000Z'), assets: [] },
    })
    prisma.userFile.findFirst.mockResolvedValue({ id: crypto.randomUUID() })

    await service.downloadWebsiteAsset(githubUser, projectId, 'dist')

    expect(prisma.userFile.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: githubUser.id, runId, name: 'dist.zip', direction: 'OUTPUT', status: 'AVAILABLE' }),
    }))
    expect(outputs.loadForOwner).toHaveBeenCalledWith(expect.any(String), githubUser.id)
  })

  it('does not allow expired website artifacts to reach object storage', async () => {
    const { service, prisma, outputs } = setup()
    prisma.webProject.findFirst.mockResolvedValue({
      id: crypto.randomUUID(),
      userId: githubUser.id,
      agentRunId: crypto.randomUUID(),
      creation: { expiresAt: new Date('2026-08-04T00:00:00.000Z'), assets: [] },
    })

    await expect(service.downloadWebsiteAsset(githubUser, crypto.randomUUID(), 'source')).rejects.toBeInstanceOf(NotFoundException)
    expect(prisma.userFile.findFirst).not.toHaveBeenCalled()
    expect(outputs.loadForOwner).not.toHaveBeenCalled()
  })

  it('marks a completed run as failed when either required website archive is missing', async () => {
    const { service, prisma } = setup()
    const projectId = crypto.randomUUID()
    const runId = crypto.randomUUID()
    prisma.webProject.findFirst.mockResolvedValue(webProject(projectId, runId))
    prisma.userFile.findMany.mockResolvedValue([{ id: crypto.randomUUID(), runId, name: 'dist.zip', createdAt: new Date() }])
    prisma.agentRun.findMany.mockResolvedValue([{ id: runId, status: 'SUCCEEDED', errorCode: null, errorMessage: null }])

    const result = await service.getWebsite(githubUser, projectId)

    expect(result.status).toBe('failed')
    expect(prisma.webProject.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'FAILED', errorCode: 'WEB_PROJECT_ARTIFACTS_MISSING' }),
    }))
  })
})

function setup() {
  const prisma = {
    webProject: { findFirst: jest.fn(), update: jest.fn() },
    userFile: { findFirst: jest.fn(), findMany: jest.fn() },
    agentRun: { findMany: jest.fn() },
  } as unknown as {
    webProject: { findFirst: jest.Mock; update: jest.Mock }
    userFile: { findFirst: jest.Mock; findMany: jest.Mock }
    agentRun: { findMany: jest.Mock }
  }
  const outputs = { loadForOwner: jest.fn() } as unknown as AgentOutputFileService
  return {
    prisma,
    outputs,
    service: new CreationsService(prisma as unknown as PrismaService, {} as AgentService, outputs, new WebProjectArchiveValidator(), { loadUserFile: jest.fn(), writeUserFile: jest.fn() } as never),
  }
}

function webProject(id: string, agentRunId: string) {
  const now = new Date('2026-08-05T00:00:00.000Z')
  return {
    id,
    agentRunId,
    status: 'GENERATING',
    updatedAt: now,
    creation: { id: crypto.randomUUID(), title: '测试网站', expiresAt: new Date('2026-09-04T00:00:00.000Z'), createdAt: now, assets: [] },
  }
}
