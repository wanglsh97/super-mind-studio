import { ConfigService } from '@nestjs/config';

import { mapBailianImageRequest } from './bailian-image.mapper';
import { ImageModelCatalog } from './image-model.catalog';

describe('Bailian image request mappers', () => {
  const catalog = new ImageModelCatalog(
    new ConfigService({ BAILIAN_IMAGE_DEFAULT_MODEL: 'qwen-image' }),
  );
  const input = {
    prompt: 'fixture prompt',
    aspectRatio: '1:1' as const,
    quality: '2K' as const,
    watermark: false,
  };

  it.each([
    ['qwen-image', 'qwen-image-2.0-pro'],
    ['wan-image', 'wan2.7-image-pro'],
    ['kling-image', 'kling/kling-v3-image-generation'],
    ['vidu-image', 'vidu/vidu-image_reference2image'],
  ] as const)('maps %s without provider-controlled output count', (id, upstream) => {
    const body = mapBailianImageRequest(catalog.resolve(id), input);
    expect(body.model).toBe(upstream);
    expect(JSON.stringify(body)).toContain('"n":1');
    expect(JSON.stringify(body)).not.toContain('fixture-task');
  });
});
