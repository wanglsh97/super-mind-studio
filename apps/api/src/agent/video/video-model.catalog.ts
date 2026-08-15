import type { VideoAspectRatio, VideoResolution } from '@supermind/sdk';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type VideoBrand = 'kling' | 'happyhorse' | 'vidu' | 'pixverse';
export interface VideoRequestSettings {
  inputMode: 'text' | 'first_frame';
  durationSeconds: number;
  resolution: VideoResolution;
  aspectRatio: VideoAspectRatio | null;
  audio: boolean;
  preferredBrand?: VideoBrand;
}
export interface VideoModelDefinition {
  id: string;
  brand: VideoBrand;
  upstreamModel: string;
  submitPath: string;
  inputMode: VideoRequestSettings['inputMode'];
  durations: readonly number[];
  resolutions: readonly VideoResolution[];
  aspectRatios: readonly VideoAspectRatio[];
  supportsAudio: boolean;
  priceCnyPerSecond: string;
}

const MODELS: readonly VideoModelDefinition[] = [
  {
    id: 'kling-v3-t2v',
    brand: 'kling',
    upstreamModel: 'kling/kling-v3-video-generation',
    submitPath: '/services/aigc/video-generation/video-synthesis',
    inputMode: 'text',
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolutions: ['720p', '1080p'],
    aspectRatios: ['16:9', '9:16', '1:1'],
    supportsAudio: true,
    priceCnyPerSecond: '0',
  },
  {
    id: 'kling-v3-i2v',
    brand: 'kling',
    upstreamModel: 'kling/kling-v3-video-generation',
    submitPath: '/services/aigc/video-generation/video-synthesis',
    inputMode: 'first_frame',
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolutions: ['720p', '1080p'],
    aspectRatios: ['16:9', '9:16', '1:1'],
    supportsAudio: true,
    priceCnyPerSecond: '0',
  },
  {
    id: 'happyhorse-1.1-t2v',
    brand: 'happyhorse',
    upstreamModel: 'happyhorse-1.1-t2v',
    submitPath: '/services/aigc/video-generation/video-synthesis',
    inputMode: 'text',
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolutions: ['720p', '1080p'],
    aspectRatios: ['16:9', '9:16', '1:1'],
    supportsAudio: true,
    priceCnyPerSecond: '0',
  },
  {
    id: 'happyhorse-1.1-i2v',
    brand: 'happyhorse',
    upstreamModel: 'happyhorse-1.1-i2v',
    submitPath: '/services/aigc/video-generation/video-synthesis',
    inputMode: 'first_frame',
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolutions: ['720p', '1080p'],
    aspectRatios: ['16:9', '9:16', '1:1'],
    supportsAudio: true,
    priceCnyPerSecond: '0',
  },
  {
    id: 'viduq3-turbo-t2v',
    brand: 'vidu',
    upstreamModel: 'vidu/viduq3-turbo_text2video',
    submitPath: '/services/aigc/video-generation/video-synthesis',
    inputMode: 'text',
    durations: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
    resolutions: ['540p', '720p', '1080p'],
    aspectRatios: ['16:9', '9:16', '1:1'],
    supportsAudio: true,
    priceCnyPerSecond: '0',
  },
  {
    id: 'viduq3-turbo-i2v',
    brand: 'vidu',
    upstreamModel: 'vidu/viduq3-turbo_img2video',
    submitPath: '/services/aigc/video-generation/video-synthesis',
    inputMode: 'first_frame',
    durations: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
    resolutions: ['540p', '720p', '1080p'],
    aspectRatios: ['16:9', '9:16', '1:1'],
    supportsAudio: true,
    priceCnyPerSecond: '0',
  },
  {
    id: 'pixverse-v6-r2v-t2v',
    brand: 'pixverse',
    upstreamModel: 'pixverse/pixverse-v6-r2v',
    submitPath: '/services/aigc/video-generation/video-synthesis',
    inputMode: 'text',
    durations: [5, 8, 10],
    resolutions: ['720p', '1080p'],
    aspectRatios: ['16:9', '9:16', '1:1'],
    supportsAudio: true,
    priceCnyPerSecond: '0',
  },
  {
    id: 'pixverse-v6-r2v-i2v',
    brand: 'pixverse',
    upstreamModel: 'pixverse/pixverse-v6-r2v',
    submitPath: '/services/aigc/video-generation/video-synthesis',
    inputMode: 'first_frame',
    durations: [5, 8, 10],
    resolutions: ['720p', '1080p'],
    aspectRatios: ['16:9', '9:16', '1:1'],
    supportsAudio: true,
    priceCnyPerSecond: '0',
  },
];

@Injectable()
export class VideoModelCatalog {
  readonly version = '2026-08-15';

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  list(): VideoModelDefinition[] {
    return MODELS.map((m) => ({
      ...m,
      durations: [...m.durations],
      resolutions: [...m.resolutions],
      aspectRatios: [...m.aspectRatios],
    }));
  }
  resolve(id: string): VideoModelDefinition {
    const model = this.list().find((m) => m.id === id);
    if (!model) throw new Error('持久化视频任务使用了未知模型');
    return model;
  }
  candidates(settings: VideoRequestSettings): VideoModelDefinition[] {
    const all = this.list().filter(
      (m) =>
        m.inputMode === settings.inputMode &&
        m.durations.includes(settings.durationSeconds) &&
        m.resolutions.includes(settings.resolution) &&
        (!settings.audio || m.supportsAudio) &&
        (settings.inputMode === 'first_frame' ||
          (settings.aspectRatio !== null && m.aspectRatios.includes(settings.aspectRatio))),
    );
    const preferred = settings.preferredBrand
      ? all.filter((m) => m.brand === settings.preferredBrand)
      : [];
    return preferred.length ? preferred : all;
  }
  choose(settings: VideoRequestSettings, boundId: string | null) {
    const candidates = this.candidates(settings);
    const bound = candidates.find((m) => m.id === boundId);
    const defaultBrand = this.config.getOrThrow<VideoBrand>('BAILIAN_VIDEO_DEFAULT_BRAND');
    const model =
      bound ?? candidates.find((candidate) => candidate.brand === defaultBrand) ?? candidates[0];
    if (!model) throw new Error('没有可用的视频模型');
    return { model, switched: Boolean(boundId && boundId !== model.id), candidates };
  }
}
