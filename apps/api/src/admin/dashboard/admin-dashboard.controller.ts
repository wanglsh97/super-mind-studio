import { Controller, Get, Inject } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';

import { ADMIN_SESSION_COOKIE } from '../auth/admin-auth.service';
import { AdminDashboardService } from './admin-dashboard.service';

@ApiTags('Admin')
@ApiCookieAuth(ADMIN_SESSION_COOKIE)
@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(@Inject(AdminDashboardService) private readonly dashboard: AdminDashboardService) {}

  @Get('overview')
  overview() {
    return this.dashboard.overview();
  }

  @Get('trends')
  trends() {
    return this.dashboard.trends();
  }

  @Get('latencies')
  latencies() {
    return this.dashboard.latencies();
  }

  @Get('errors')
  errors() {
    return this.dashboard.errors();
  }

  @Get('token-analytics')
  tokenAnalytics() {
    return this.dashboard.tokenAnalytics();
  }
}
