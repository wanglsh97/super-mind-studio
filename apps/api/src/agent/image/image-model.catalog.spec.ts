import { ImageModelCatalog } from './image-model.catalog';

describe('ImageModelCatalog', () => {
  it('publishes all built-in platform ids while keeping upstream ids server-side', () => {
    const catalog = new ImageModelCatalog();
    expect(catalog.capabilities().map((model) => model.id)).toEqual([
      'qwen-image',
      'wan-image',
      'kling-image',
      'vidu-image',
    ]);
    expect(catalog.resolve('qwen-image').upstreamModel).toBe('qwen-image-2.0-pro');
  });

  it('rejects unknown ids instead of silently failing over', () => {
    const catalog = new ImageModelCatalog();
    expect(() => catalog.resolve('unknown' as 'qwen-image')).toThrow('不支持');
  });
});
