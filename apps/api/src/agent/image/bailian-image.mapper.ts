import type {
  GenerateImageToolArguments,
  ImageAspectRatio,
  ImageModelId,
  ImageQuality,
} from '@supermind/sdk';

import type { ImageModelDefinition } from './image-model.catalog';

export interface ImageProviderInput {
  prompt: string;
  aspectRatio: ImageAspectRatio;
  quality: ImageQuality;
  watermark: boolean;
  reference?: { dataUrl?: string; temporaryUrl?: string };
}

const PIXEL_SIZE: Record<ImageAspectRatio, Record<ImageQuality, string>> = {
  '1:1': { '1K': '1024*1024', '2K': '2048*2048', '4K': '4096*4096' },
  '4:3': { '1K': '1152*864', '2K': '2304*1728', '4K': '4096*3072' },
  '3:4': { '1K': '864*1152', '2K': '1728*2304', '4K': '3072*4096' },
  '16:9': { '1K': '1280*720', '2K': '2560*1440', '4K': '4096*2304' },
  '9:16': { '1K': '720*1280', '2K': '1440*2560', '4K': '2304*4096' },
};

export function mapBailianImageRequest(
  model: ImageModelDefinition,
  input: ImageProviderInput,
): Record<string, unknown> {
  const reference = input.reference?.dataUrl ?? input.reference?.temporaryUrl;
  if (model.id === 'qwen-image') {
    return {
      model: model.upstreamModel,
      input: {
        messages: [
          {
            role: 'user',
            content: [...(reference ? [{ image: reference }] : []), { text: input.prompt }],
          },
        ],
      },
      parameters: {
        size: PIXEL_SIZE[input.aspectRatio][input.quality],
        n: 1,
        watermark: input.watermark,
      },
    };
  }
  if (model.id === 'wan-image') {
    return {
      model: model.upstreamModel,
      input: {
        messages: [
          {
            role: 'user',
            content: [...(reference ? [{ image: reference }] : []), { text: input.prompt }],
          },
        ],
      },
      parameters: {
        size: PIXEL_SIZE[input.aspectRatio][input.quality],
        n: 1,
        watermark: input.watermark,
      },
    };
  }
  if (model.id === 'kling-image')
    return {
      model: model.upstreamModel,
      input: {
        messages: [
          {
            role: 'user',
            content: [{ text: input.prompt }, ...(reference ? [{ image: reference }] : [])],
          },
        ],
      },
      parameters: {
        resolution: input.quality.toLowerCase(),
        aspect_ratio: input.aspectRatio,
        n: 1,
        watermark: input.watermark,
      },
    };
  return {
    model: model.upstreamModel,
    input: {
      messages: [
        {
          role: 'user',
          content: [{ text: input.prompt }, ...(reference ? [{ image: reference }] : [])],
        },
      ],
    },
    parameters: {
      size: PIXEL_SIZE[input.aspectRatio][input.quality],
      n: 1,
      watermark: input.watermark,
    },
  };
}

export function normalizeGenerateImageArgs(
  args: GenerateImageToolArguments,
  defaultModel: ImageModelId,
): Required<Omit<GenerateImageToolArguments, 'referenceImageId'>> &
  Pick<GenerateImageToolArguments, 'referenceImageId'> {
  return {
    prompt: args.prompt.trim(),
    model: args.model ?? defaultModel,
    aspectRatio: args.aspectRatio ?? '1:1',
    quality: args.quality ?? '2K',
    watermark: args.watermark ?? false,
    ...(args.referenceImageId ? { referenceImageId: args.referenceImageId } : {}),
  };
}
