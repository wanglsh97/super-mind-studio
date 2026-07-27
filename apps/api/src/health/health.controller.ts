import { Controller, Get, Inject } from '@nestjs/common'
import { HealthCheck, HealthCheckService } from '@nestjs/terminus'

import { ServiceHealthIndicator } from './service-health.indicator'

@Controller('health')
export class HealthController {
  constructor(
    @Inject(HealthCheckService) private readonly health: HealthCheckService,
    @Inject(ServiceHealthIndicator) private readonly dependencies: ServiceHealthIndicator,
  ) {}

  @Get('live')
  live() {
    return {
      status: 'ok',
      service: 'ai-gateway-api',
      timestamp: new Date().toISOString(),
    }
  }

  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.dependencies.postgresql(),
      () => this.dependencies.redis(),
      () => this.dependencies.opensandbox(),
    ])
  }
}
