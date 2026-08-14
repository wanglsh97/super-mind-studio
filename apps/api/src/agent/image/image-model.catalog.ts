import type {
  ImageAspectRatio,
  ImageModelCapability,
  ImageModelId,
  ImageQuality,
} from '@supermind/sdk';
import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';

export interface ImageModelDefinition extends ImageModelCapability {
  upstreamModel: string;
  enabled: boolean;
  submitPath: string;
  asynchronous: boolean;
  priceCny: string;
}

const DEFINITIONS: readonly Omit<ImageModelDefinition, 'enabled' | 'priceCny'>[] = [
  {
    id: 'qwen-image',
    name: 'Qwen Image 2.0 Pro',
    description: '文字渲染、写实质感和复杂指令遵循',
    upstreamModel: 'qwen-image-2.0-pro',
    submitPath: '/services/aigc/multimodal-generation/generation',
    supportsTextToImage: true,
    supportsReferenceImage: true,
    aspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16'],
    qualities: ['1K', '2K'],
    supportsWatermark: true,
    asynchronous: false,
  },
  {
    id: 'wan-image',
    name: '万相 2.7 Pro',
    description: '品牌色、角色一致性和高分辨率编辑',
    upstreamModel: 'wan2.7-image-pro',
    submitPath: '/services/aigc/image-generation/generation',
    supportsTextToImage: true,
    supportsReferenceImage: true,
    aspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16'],
    qualities: ['1K', '2K', '4K'],
    supportsWatermark: true,
    asynchronous: true,
  },
  {
    id: 'kling-image',
    name: '可灵 V3 Image',
    description: '高质量创意图像和参考图生成',
    upstreamModel: 'kling/kling-v3-image-generation',
    submitPath: '/services/aigc/image-generation/generation',
    supportsTextToImage: true,
    supportsReferenceImage: true,
    aspectRatios: ['1:1', '16:9', '9:16'],
    qualities: ['1K', '2K'],
    supportsWatermark: true,
    asynchronous: true,
  },
  {
    id: 'vidu-image',
    name: 'Vidu Image',
    description: '主体参考与风格一致性生成',
    upstreamModel: 'vidu/vidu-image_reference2image',
    submitPath: '/services/aigc/image-generation/generation',
    supportsTextToImage: true,
    supportsReferenceImage: true,
    aspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16'],
    qualities: ['1K', '2K'],
    supportsWatermark: true,
    asynchronous: true,
  },
];

@Injectable()
export class ImageModelCatalog {
  readonly version = '2026-08-14';

  list(): ImageModelDefinition[] {
    return DEFINITIONS.map((definition) => ({
      ...definition,
      aspectRatios: [...definition.aspectRatios],
      qualities: [...definition.qualities],
      enabled: true,
      priceCny: '0',
    }));
  }

  capabilities(): ImageModelCapability[] {
    return this.list()
      .filter((model) => model.enabled)
      .map((model) => ({
        id: model.id,
        name: model.name,
        description: model.description,
        supportsTextToImage: model.supportsTextToImage,
        supportsReferenceImage: model.supportsReferenceImage,
        aspectRatios: [...model.aspectRatios],
        qualities: [...model.qualities],
        supportsWatermark: model.supportsWatermark,
      }));
  }

  resolve(id: ImageModelId = 'qwen-image'): ImageModelDefinition {
    const model = this.list().find((item) => item.id === id);
    if (!model) throw new BadRequestException('不支持的图片模型');
    if (!model.enabled) {
      throw new ServiceUnavailableException({
        code: 'IMAGE_MODEL_DISABLED',
        message: `图片模型 ${id} 当前未启用`,
        availableModels: this.capabilities().map((item) => item.id),
      });
    }
    return model;
  }

  resolvePersisted(id: string): ImageModelDefinition {
    const model = this.list().find((item) => item.id === id);
    if (!model) throw new BadRequestException('持久化图片任务使用了未知模型');
    return model;
  }

  validateSettings(
    model: ImageModelDefinition,
    input: { aspectRatio: ImageAspectRatio; quality: ImageQuality; watermark: boolean },
  ): void {
    if (!model.aspectRatios.includes(input.aspectRatio))
      throw new BadRequestException('图片比例不受模型支持');
    if (!model.qualities.includes(input.quality))
      throw new BadRequestException('图片质量不受模型支持');
    if (input.watermark && !model.supportsWatermark)
      throw new BadRequestException('图片模型不支持水印');
  }
}
