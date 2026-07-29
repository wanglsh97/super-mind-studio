import { Module } from '@nestjs/common'

import { ModelGatewayModule } from '../../chat/model-gateway.module'
import { AdminDashboardController } from './admin-dashboard.controller'
import { AdminDashboardService } from './admin-dashboard.service'

@Module({
  imports: [ModelGatewayModule],
  controllers: [AdminDashboardController],
  providers: [AdminDashboardService],
})
export class AdminDashboardModule {}
