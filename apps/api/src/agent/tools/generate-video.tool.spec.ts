import type { VideoGenerationToolResult } from '@supermind/sdk';

import { createGenerateVideoTool } from './generate-video.tool';
import type { VideoGenerationService } from '../video/video-generation.service';

const context = {
  toolCallId: 'tool-1',
  runId: 'run-1',
  userId: 'user-1',
  signal: new AbortController().signal,
};

function result(status: VideoGenerationToolResult['status']): VideoGenerationToolResult {
  return {
    taskId: 'task-1',
    videoId: 'video-1',
    status,
    originalPrompt: 'cat',
    effectivePrompt: 'cat',
    settings: {
      inputMode: 'text',
      durationSeconds: 5,
      resolution: '720p',
      aspectRatio: '16:9',
      audio: true,
    },
    previewUrl: null,
    saveUrl: null,
    downloadUrl: null,
    sandboxExpiresAt: null,
    saved: false,
    creationId: null,
    modelSwitched: false,
    suggestions: [],
    ...(status === 'failed'
      ? {
          error: {
            requestId: 'task-1',
            code: 'PROVIDER_REJECTED',
            message: 'provider rejected request',
            retryable: false,
          },
        }
      : {}),
  };
}

describe('generate_video tool', () => {
  it('returns a successful Tool result only for a succeeded video', async () => {
    const videos = { generate: jest.fn().mockResolvedValue(result('succeeded')) };
    await expect(
      createGenerateVideoTool(videos as unknown as VideoGenerationService).execute(
        { prompt: 'cat' },
        context,
      ),
    ).resolves.toMatchObject({ isError: false, summary: '视频生成成功' });
  });

  it('marks provider failure as a Tool error and preserves its code', async () => {
    const videos = { generate: jest.fn().mockResolvedValue(result('failed')) };
    await expect(
      createGenerateVideoTool(videos as unknown as VideoGenerationService).execute(
        { prompt: 'cat' },
        context,
      ),
    ).resolves.toMatchObject({
      isError: true,
      content: 'provider rejected request',
      audit: { code: 'PROVIDER_REJECTED' },
    });
  });
});
