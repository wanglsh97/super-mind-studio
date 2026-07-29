import { Module } from '@nestjs/common'

import { TokenAnalyticsService } from './token-analytics.service'

@Module({
  providers: [TokenAnalyticsService],
  exports: [TokenAnalyticsService],
})
export class TokenAnalyticsModule {}
