import type { GenerateImageToolArguments } from '@supermind/sdk';

import type { AgentToolDefinition } from './agent-tool';
import { ImageGenerationService } from '../image/image-generation.service';

export function createGenerateImageTool(
  images: ImageGenerationService,
): AgentToolDefinition<GenerateImageToolArguments & Record<string, unknown>> {
  return {
    name: 'generate_image',
    label: '生成图片',
    description:
      '根据提示词生成或基于当前 Thread 上一张有效图片修改一张图片。每个 Run 只能调用一次。',
    riskLevel: 'external_send',
    approvalPolicy: 'none',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', minLength: 1, maxLength: 5000 },
        model: { type: 'string', enum: ['qwen-image', 'wan-image', 'kling-image', 'vidu-image'] },
        referenceImageId: { type: 'string', format: 'uuid' },
        aspectRatio: { type: 'string', enum: ['1:1', '4:3', '3:4', '16:9', '9:16'] },
        quality: { type: 'string', enum: ['1K', '2K', '4K'] },
        watermark: { type: 'boolean' },
      },
    },
    execute: async (args, context) => {
      const result = await images.generate(args, context);
      const isError = !['succeeded'].includes(result.status);
      return {
        content: isError
          ? `图片任务未成功：${result.error?.message ?? result.status}。不要自动重试或切换模型。`
          : `图片已生成。实际模型：${result.modelName}。后续调整项已包含在结构化结果中，不要在正文中重复罗列。`,
        summary: isError ? '图片生成未成功' : '图片生成成功',
        // 图片任务业务终态由 imageGeneration.status 表达；保留结构化 result 供 Tool UI 恢复。
        // Provider 失败不抛出 harness 异常，避免 Pi 丢弃自定义 details。
        isError: false,
        audit: { code: result.error?.code, imageGeneration: result },
      };
    },
  };
}
