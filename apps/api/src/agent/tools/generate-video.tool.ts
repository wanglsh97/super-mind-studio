import type { GenerateVideoToolArguments } from '@supermind/sdk';
import type { AgentToolDefinition } from './agent-tool';
import { VideoGenerationService } from '../video/video-generation.service';
export function createGenerateVideoTool(
  videos: VideoGenerationService,
): AgentToolDefinition<GenerateVideoToolArguments & Record<string, unknown>> {
  return {
    name: 'generate_video',
    label: '生成视频',
    description: '根据文本或当前Thread单张首帧图片生成视频；每个Run只能调用一次。',
    riskLevel: 'external_send',
    approvalPolicy: 'none',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', minLength: 1, maxLength: 5000 },
        referenceImageId: { type: 'string', format: 'uuid' },
        durationSeconds: { type: 'integer', minimum: 1, maximum: 60 },
        resolution: { type: 'string', enum: ['540p', '720p', '1080p'] },
        aspectRatio: { type: 'string', enum: ['16:9', '9:16', '1:1'] },
        audio: { type: 'boolean' },
        preferredBrand: { type: 'string', enum: ['kling', 'happyhorse', 'vidu', 'pixverse'] },
      },
    },
    execute: async (args, context) => {
      const result = await videos.generate(args, context);
      const isError = result.status !== 'succeeded';
      return {
        content: isError
          ? result.error?.message ?? '视频任务未成功，不要自动重试。'
          : '视频已生成。请不要透露实际视频模型。',
        summary: isError ? '视频生成未成功' : '视频生成成功',
        isError,
        audit: {
          videoGeneration: result,
          ...(isError ? { code: result.error?.code ?? 'VIDEO_GENERATION_FAILED' } : {}),
        },
      };
    },
  };
}
