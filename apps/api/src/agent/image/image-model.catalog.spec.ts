import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { ImageModelCatalog } from './image-model.catalog';

describe('ImageModelCatalog', () => {
  it('publishes all built-in platform ids while keeping upstream ids server-side', () => {
    const catalog = new ImageModelCatalog(
      new ConfigService({ BAILIAN_IMAGE_DEFAULT_MODEL: 'qwen-image' }),
    );
    expect(catalog.capabilities().map((model) => model.id)).toEqual([
      'qwen-image',
      'wan-image',
      'kling-image',
      'vidu-image',
    ]);
    expect(catalog.resolve('qwen-image').upstreamModel).toBe('qwen-image-2.0-pro');
  });

  it('rejects unknown ids instead of silently failing over', () => {
    const catalog = new ImageModelCatalog(
      new ConfigService({ BAILIAN_IMAGE_DEFAULT_MODEL: 'qwen-image' }),
    );
    expect(() => catalog.resolve('unknown' as 'qwen-image')).toThrow('不支持');
  });

  it('uses the configured default model when no model is supplied', () => {
    const catalog = new ImageModelCatalog(
      new ConfigService({ BAILIAN_IMAGE_DEFAULT_MODEL: 'wan-image' }),
    );
    expect(catalog.resolve().id).toBe('wan-image');
  });

  it('receives ConfigService through the Nest container', async () => {
    const module = await Test.createTestingModule({
      providers: [
        ImageModelCatalog,
        {
          provide: ConfigService,
          useValue: new ConfigService({ BAILIAN_IMAGE_DEFAULT_MODEL: 'qwen-image' }),
        },
      ],
    }).compile();
    expect(module.get(ImageModelCatalog).resolve().id).toBe('qwen-image');
  });
});
