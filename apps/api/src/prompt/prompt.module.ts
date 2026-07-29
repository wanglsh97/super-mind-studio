import { Module } from '@nestjs/common'

import { PricingService } from '../billing/pricing.service'
import { ModelGatewayModule } from '../chat/model-gateway.module'
import { RateLimitModule } from '../rate-limit/rate-limit.module'
import { RequestLifecycleModule } from '../request-lifecycle/request-lifecycle.module'
import { UserAuthModule } from '../user-auth/user-auth.module'
import { PromptController } from './prompt.controller'
import { PromptTemplateRegistry } from './prompt-template.registry'

@Module({
  imports: [ModelGatewayModule, RateLimitModule, RequestLifecycleModule, UserAuthModule],
  providers: [PromptTemplateRegistry, PricingService],
  controllers: [PromptController],
})
export class PromptModule {}
