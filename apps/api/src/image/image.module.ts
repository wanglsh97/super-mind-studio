import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'

import { RateLimitModule } from '../rate-limit/rate-limit.module'
import { UserAuthModule } from '../user-auth/user-auth.module'
import type { ImageAdapter } from './adapters/image-adapter'
import { IMAGE_ADAPTERS, ImageAdapterRegistry } from './adapters/image-adapter.registry'
import {
  DEFAULT_MOCK_IMAGE_ADAPTER_OPTIONS,
  MOCK_IMAGE_ADAPTER_OPTIONS,
  MockImageAdapter,
} from './adapters/mock-image-adapter'
import { ImageController } from './image.controller'
import { ImageService } from './image.service'

@Module({
  imports: [ConfigModule, RateLimitModule, UserAuthModule],
  providers: [
    { provide: MOCK_IMAGE_ADAPTER_OPTIONS, useValue: DEFAULT_MOCK_IMAGE_ADAPTER_OPTIONS },
    MockImageAdapter,
    {
      provide: IMAGE_ADAPTERS,
      inject: [ConfigService, MockImageAdapter],
      useFactory: (config: ConfigService, mock: MockImageAdapter): readonly ImageAdapter[] => {
        return config.get<boolean>('MOCK_PROVIDER_ENABLED') ? [mock] : []
      },
    },
    ImageAdapterRegistry,
    ImageService,
  ],
  controllers: [ImageController],
  exports: [ImageAdapterRegistry],
})
export class ImageModule {}
