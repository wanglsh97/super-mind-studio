import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { VideoModelCatalog } from './video-model.catalog';
describe('VideoModelCatalog', () => {
  const catalog = new VideoModelCatalog(
    new ConfigService({ BAILIAN_VIDEO_DEFAULT_BRAND: 'happyhorse' }),
  );
  const defaults = {
    inputMode: 'text' as const,
    durationSeconds: 5,
    resolution: '720p' as const,
    aspectRatio: '16:9' as const,
    audio: true,
  };
  it('aggregates all four brands for the default request', () =>
    expect(new Set(catalog.candidates(defaults).map((m) => m.brand))).toEqual(
      new Set(['kling', 'happyhorse', 'vidu', 'pixverse']),
    ));
  it('uses the activated PixVerse v6 model for both supported input modes', () =>
    expect(
      catalog
        .list()
        .filter((model) => model.brand === 'pixverse')
        .map((model) => model.upstreamModel),
    ).toEqual(['pixverse/pixverse-v6-r2v', 'pixverse/pixverse-v6-r2v']));
  it('uses HappyHorse by default instead of choosing randomly', () =>
    expect(catalog.choose(defaults, null).model.id).toBe('happyhorse-1.1-t2v'));
  it('uses the configured default brand', () => {
    const configured = new VideoModelCatalog(
      new ConfigService({ BAILIAN_VIDEO_DEFAULT_BRAND: 'vidu' }),
    );
    expect(configured.choose(defaults, null).model.id).toBe('viduq3-turbo-t2v');
  });
  it('receives ConfigService through the Nest container', async () => {
    const module = await Test.createTestingModule({
      providers: [
        VideoModelCatalog,
        {
          provide: ConfigService,
          useValue: new ConfigService({ BAILIAN_VIDEO_DEFAULT_BRAND: 'happyhorse' }),
        },
      ],
    }).compile();
    expect(module.get(VideoModelCatalog).choose(defaults, null).model.brand).toBe('happyhorse');
  });
  it('reuses a compatible binding', () =>
    expect(catalog.choose(defaults, 'kling-v3-t2v').model.id).toBe('kling-v3-t2v'));
  it('keeps a PixVerse binding when a temporary OSS URL makes first-frame input compatible', () =>
    expect(
      catalog.choose(
        { ...defaults, inputMode: 'first_frame', aspectRatio: null },
        'pixverse-v6-r2v-i2v',
      ).model.id,
    ).toBe('pixverse-v6-r2v-i2v'));
  it('switches an incompatible binding', () =>
    expect(
      catalog.choose({ ...defaults, inputMode: 'first_frame', aspectRatio: null }, 'kling-v3-t2v')
      .switched,
    ).toBe(true));
  it('honors a supported brand preference', () =>
    expect(catalog.choose({ ...defaults, preferredBrand: 'vidu' }, null).model.brand).toBe('vidu'));
});
