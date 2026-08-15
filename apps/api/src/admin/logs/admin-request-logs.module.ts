import { Module } from '@nestjs/common';

import { AdminRequestLogsController } from './admin-request-logs.controller';
import { AdminRequestLogsService } from './admin-request-logs.service';

@Module({
  controllers: [AdminRequestLogsController],
  providers: [AdminRequestLogsService],
})
export class AdminRequestLogsModule {}
