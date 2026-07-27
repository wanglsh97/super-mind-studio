import { Module } from '@nestjs/common'
import { TerminusModule } from '@nestjs/terminus'

import { AgentModule } from '../agent/agent.module'
import { HealthController } from './health.controller'
import { ServiceHealthIndicator } from './service-health.indicator'

@Module({
  imports: [TerminusModule, AgentModule],
  controllers: [HealthController],
  providers: [ServiceHealthIndicator],
})
export class HealthModule {}
