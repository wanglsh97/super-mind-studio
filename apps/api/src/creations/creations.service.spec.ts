import { NotFoundException } from '@nestjs/common'

import type { PrismaService } from '../database/prisma.service'
import type { AuthenticatedUser } from '../user/user.types'
import { CreationsService } from './creations.service'

const githubUser: AuthenticatedUser = {
  id: '00000000-0000-4000-8000-000000000001',
  authProvider: 'GITHUB',
  userName: 'octocat',
  avatarUrl: null,
}

describe('CreationsService', () => {
  it('keeps the unified creation library available to an authenticated anonymous owner', async () => {
    const { service, projects } = setup()

    await expect(service.list({ ...githubUser, authProvider: 'ANONYMOUS' })).resolves.toEqual([])
    expect(projects.listWebsitesForOwner).toHaveBeenCalledWith(githubUser.id)
  })

  it('returns only the current successful non-expired website delivery', async () => {
    const { service, projects } = setup()
    const successful = webProject('SUCCEEDED', new Date('2099-09-04T00:00:00.000Z'))
    projects.listWebsitesForOwner.mockResolvedValue([
      successful,
      webProject('GENERATING', new Date('2099-09-04T00:00:00.000Z')),
      webProject('SUCCEEDED', new Date('2000-01-01T00:00:00.000Z')),
    ])

    const result = await service.list(githubUser)

    expect(result).toEqual([
      expect.objectContaining({
        projectId: successful.id,
        type: 'website',
        runId: successful.agentRunId,
        assets: [
          expect.objectContaining({ downloadUrl: expect.stringContaining('/creations/assets/') }),
        ],
      }),
    ])
  })

  it('does not reveal an expired creation asset', async () => {
    const { service, prisma, objects } = setup()
    prisma.creationAsset.findFirst.mockResolvedValue({
      id: crypto.randomUUID(),
      objectKey: 'creations/private/source.zip',
      expiresAt: new Date('2000-01-01T00:00:00.000Z'),
      creation: { expiresAt: new Date('2000-01-01T00:00:00.000Z') },
    })

    await expect(service.loadAsset(githubUser, crypto.randomUUID())).rejects.toBeInstanceOf(
      NotFoundException,
    )
    expect(objects.loadUserFile).not.toHaveBeenCalled()
  })
})

function setup() {
  const prisma = {
    imageGenerationTask: { findMany: jest.fn().mockResolvedValue([]) },
    creationAsset: { findFirst: jest.fn() },
  } as unknown as {
    imageGenerationTask: { findMany: jest.Mock }
    creationAsset: { findFirst: jest.Mock }
  }
  const projects = { listWebsitesForOwner: jest.fn().mockResolvedValue([]) }
  const objects = { loadUserFile: jest.fn() }
  return {
    prisma,
    projects,
    objects,
    service: new CreationsService(
      prisma as unknown as PrismaService,
      objects as never,
      projects as never,
    ),
  }
}

function webProject(status: 'GENERATING' | 'SUCCEEDED', expiresAt: Date) {
  const now = new Date('2026-08-05T00:00:00.000Z')
  const assetId = crypto.randomUUID()
  return {
    id: crypto.randomUUID(),
    userId: githubUser.id,
    creationId: crypto.randomUUID(),
    agentRunId: crypto.randomUUID(),
    agentThreadId: crypto.randomUUID(),
    status,
    framework: 'react-vite',
    buildCommand: 'pnpm build',
    outputDir: 'dist',
    errorCode: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    creation: {
      id: crypto.randomUUID(),
      userId: githubUser.id,
      type: 'WEBSITE',
      status: status === 'SUCCEEDED' ? 'SUCCEEDED' : 'RUNNING',
      title: '测试网站',
      expiresAt,
      createdAt: now,
      updatedAt: now,
      imageTaskId: null,
      assets: [
        {
          id: assetId,
          creationId: crypto.randomUUID(),
          kind: 'SOURCE_ZIP',
          name: 'source.zip',
          mimeType: 'application/zip',
          objectKey: `creations/${assetId}`,
          sizeBytes: 10n,
          sha256: 'a'.repeat(64),
          expiresAt,
          createdAt: now,
        },
      ],
    },
  }
}
