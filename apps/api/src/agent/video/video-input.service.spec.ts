import type { ConfigService } from '@nestjs/config';

import type { PrismaService } from '../../database/prisma.service';
import type { SandboxRuntimePort } from '../sandbox/sandbox-runtime.port';
import type { SkillObjectStorePort } from '../skills/storage/skill-object-store.port';
import { VideoInputService } from './video-input.service';

describe('VideoInputService', () => {
  it('returns a JSON-safe numeric size after uploading a reference image', async () => {
    const expiresAt = new Date(Date.now() + 60_000);
    const prisma = {
      agentThread: {
        findFirst: jest.fn().mockResolvedValue({ id: 'thread-1' }),
      },
      videoInputAsset: {
        create: jest.fn().mockResolvedValue({
          id: 'asset-1',
          name: 'reference.png',
          mimeType: 'image/png',
          sizeBytes: 123n,
          expiresAt,
        }),
      },
    } as unknown as PrismaService;
    const objects = {
      writeUserFile: jest.fn().mockResolvedValue({
        metadata: { sizeBytes: 123, sha256: 'sha256' },
      }),
      deleteObject: jest.fn(),
    } as unknown as SkillObjectStorePort;
    const config = {
      getOrThrow: jest.fn().mockReturnValue('test-secret'),
    } as unknown as ConfigService;
    const service = new VideoInputService(
      prisma,
      {} as SandboxRuntimePort,
      objects,
      config,
    );

    const result = await service.upload('user-1', 'thread-1', {
      originalname: 'reference.png',
      mimetype: 'image/png',
      size: 8,
      buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    });

    expect(result).toMatchObject({ id: 'asset-1', sizeBytes: 123 });
    expect(typeof result.sizeBytes).toBe('number');
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(objects.writeUserFile).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: 'input',
        contentType: 'image/png',
        objectKey: expect.stringMatching(/^video-staging\/user1\/[0-9a-f-]+\/first-frame\.png$/),
      }),
    );
  });

  it('deletes an unsubmitted temporary OSS reference', async () => {
    const prisma = {
      videoInputAsset: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'asset-1',
          objectKey: 'video-staging/user1/asset-1/first-frame.png',
        }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      videoGenerationTask: {
        count: jest.fn().mockResolvedValue(0),
      },
    } as unknown as PrismaService;
    const objects = {
      deleteObject: jest.fn().mockResolvedValue(undefined),
    } as unknown as SkillObjectStorePort;
    const config = {
      getOrThrow: jest.fn().mockReturnValue('test-secret'),
    } as unknown as ConfigService;
    const service = new VideoInputService(
      prisma,
      {} as SandboxRuntimePort,
      objects,
      config,
    );

    await service.removeUnsubmitted('user-1', 'thread-1', 'asset-1');

    expect(objects.deleteObject).toHaveBeenCalledWith(
      'video-staging/user1/asset-1/first-frame.png',
    );
    expect(prisma.videoInputAsset.deleteMany).toHaveBeenCalledWith({
      where: { id: 'asset-1', userId: 'user-1', threadId: 'thread-1' },
    });
  });
});
