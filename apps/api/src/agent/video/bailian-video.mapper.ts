import type { VideoModelDefinition, VideoRequestSettings } from './video-model.catalog';

export function mapBailianVideoRequest(
  model: VideoModelDefinition,
  input: VideoRequestSettings & { prompt: string; referenceUrl?: string },
) {
  const parameters: Record<string, unknown> = {
    duration: input.durationSeconds,
    audio: input.audio,
    watermark: true,
  };
  if (model.brand === 'kling') parameters.mode = input.resolution === '1080p' ? 'pro' : 'std';
  else if (model.brand === 'pixverse')
    parameters.size = pixverseSize(input.resolution, input.aspectRatio ?? '16:9');
  else parameters.resolution = input.resolution.toUpperCase();
  if (input.inputMode === 'text' && model.brand !== 'pixverse')
    parameters.aspect_ratio = input.aspectRatio ?? '16:9';
  const type =
    model.brand === 'kling' || model.brand === 'happyhorse'
      ? 'first_frame'
      : model.brand === 'pixverse'
        ? 'image_url'
        : 'image';
  return {
    model: model.upstreamModel,
    input: {
      prompt: input.prompt,
      ...(input.referenceUrl ? { media: [{ type, url: input.referenceUrl }] } : {}),
    },
    parameters,
  };
}

function pixverseSize(
  resolution: VideoRequestSettings['resolution'],
  aspectRatio: NonNullable<VideoRequestSettings['aspectRatio']>,
) {
  const sizes = {
    '540p': { '16:9': '1024*576', '9:16': '576*1024', '1:1': '1024*1024' },
    '720p': { '16:9': '1280*720', '9:16': '720*1280', '1:1': '960*960' },
    '1080p': { '16:9': '1920*1080', '9:16': '1080*1920', '1:1': '1440*1440' },
  } as const;
  return sizes[resolution][aspectRatio];
}
