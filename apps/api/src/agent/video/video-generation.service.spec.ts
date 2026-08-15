import type { ConfigService } from '@nestjs/config';
import type { VideoGenerationTask } from '../../generated/prisma/client';
import type { PrismaService } from '../../database/prisma.service';
import type { SandboxRuntimePort } from '../sandbox/sandbox-runtime.port';
import type { BailianVideoTransport } from './bailian-video.transport';
import { VideoGenerationService } from './video-generation.service';
import type { VideoInputService } from './video-input.service';
import type { VideoModelCatalog } from './video-model.catalog';

describe('VideoGenerationService terminal state protection', () => {
  it('does not overwrite a task that another waiter already persisted successfully', async () => {
    const succeeded = {
      id: 'task-row-1',
      taskId: 'task-1',
      status: 'SUCCEEDED',
      requestLogId: 'request-1',
      prompt: 'prompt',
      effectivePrompt: 'prompt',
      inputMode: 'text',
      options: {
        durationSeconds: 5,
        resolution: '720p',
        aspectRatio: '16:9',
        audio: true,
      },
      videoId: 'video-1',
      sandboxExpiresAt: null,
      candidateAudit: null,
      errorCode: null,
      errorMessage: null,
    } as unknown as VideoGenerationTask;
    const prisma = {
      videoGenerationTask: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(succeeded),
      },
      requestLog: {
        updateMany: jest.fn(),
      },
    } as unknown as PrismaService;
    const inputs = { release: jest.fn() } as unknown as VideoInputService;
    const service = new VideoGenerationService(
      prisma,
      {} as VideoModelCatalog,
      {} as BailianVideoTransport,
      inputs,
      {} as SandboxRuntimePort,
      {} as ConfigService,
    );
    const stale = { ...succeeded, status: 'RUNNING' } as VideoGenerationTask;
    const fail = Reflect.get(service, 'fail') as (
      row: VideoGenerationTask,
      error: unknown,
    ) => Promise<{ status: string }>;

    const result = await fail.call(service, stale, new Error('fetch failed'));

    expect(result.status).toBe('succeeded');
    expect(prisma.videoGenerationTask.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'task-row-1', status: 'RUNNING' } }),
    );
    expect(prisma.requestLog.updateMany).not.toHaveBeenCalled();
    expect(inputs.release).not.toHaveBeenCalled();
  });
});
