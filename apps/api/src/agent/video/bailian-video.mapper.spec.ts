import { ConfigService } from '@nestjs/config';

import { mapBailianVideoRequest } from './bailian-video.mapper';
import { VideoModelCatalog } from './video-model.catalog';
describe('mapBailianVideoRequest', () => {
  const catalog = new VideoModelCatalog(
    new ConfigService({ BAILIAN_VIDEO_DEFAULT_BRAND: 'happyhorse' }),
  );
  it('maps Kling text defaults', () => {
    const model = catalog.resolve('kling-v3-t2v');
    expect(
      mapBailianVideoRequest(model, {
        inputMode: 'text',
        prompt: '猫奔跑',
        durationSeconds: 5,
        resolution: '720p',
        aspectRatio: '16:9',
        audio: true,
      }),
    ).toEqual({
      model: model.upstreamModel,
      input: { prompt: '猫奔跑' },
      parameters: { duration: 5, audio: true, watermark: true, mode: 'std', aspect_ratio: '16:9' },
    });
  });
  it('maps first-frame media without aspect ratio', () => {
    const model = catalog.resolve('viduq3-turbo-i2v');
    const body = mapBailianVideoRequest(model, {
      inputMode: 'first_frame',
      prompt: '动起来',
      referenceUrl: 'https://example.invalid/frame',
      durationSeconds: 5,
      resolution: '720p',
      aspectRatio: null,
      audio: true,
    });
    expect(body.input).toMatchObject({
      media: [{ type: 'image', url: 'https://example.invalid/frame' }],
    });
    expect(body.parameters).not.toHaveProperty('aspect_ratio');
  });
  it('passes an inline sandbox image to HappyHorse without converting it to a URL', () => {
    const model = catalog.resolve('happyhorse-1.1-i2v');
    const inlineImage = 'data:image/png;base64,iVBORw0KGgo=';
    const body = mapBailianVideoRequest(model, {
      inputMode: 'first_frame',
      prompt: '让人物站起来',
      referenceUrl: inlineImage,
      durationSeconds: 5,
      resolution: '720p',
      aspectRatio: null,
      audio: true,
    });
    expect(body.input).toMatchObject({
      media: [{ type: 'first_frame', url: inlineImage }],
    });
  });
  it('maps PixVerse resolution and aspect ratio to size', () => {
    const model = catalog.resolve('pixverse-v6-r2v-t2v');
    const body = mapBailianVideoRequest(model, {
      inputMode: 'text',
      prompt: '猫伸懒腰',
      durationSeconds: 5,
      resolution: '720p',
      aspectRatio: '16:9',
      audio: true,
    });
    expect(body.parameters).toEqual({
      duration: 5,
      audio: true,
      watermark: true,
      size: '1280*720',
    });
  });
  it('maps PixVerse reference media with the provider media type', () => {
    const model = catalog.resolve('pixverse-v6-r2v-i2v');
    const body = mapBailianVideoRequest(model, {
      inputMode: 'first_frame',
      prompt: '让猫动起来',
      referenceUrl: 'https://example.invalid/frame.webp',
      durationSeconds: 5,
      resolution: '1080p',
      aspectRatio: null,
      audio: true,
    });
    expect(body.input).toMatchObject({
      media: [{ type: 'image_url', url: 'https://example.invalid/frame.webp' }],
    });
    expect(body.parameters).toMatchObject({ size: '1920*1080' });
    expect(body.parameters).not.toHaveProperty('resolution');
    expect(body.parameters).not.toHaveProperty('aspect_ratio');
  });
});
