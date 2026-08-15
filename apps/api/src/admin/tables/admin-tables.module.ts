import { Module } from '@nestjs/common';

import { AdminTableAllowlist } from './admin-table-allowlist';
import { AdminTableRowsService } from './admin-table-rows.service';
import { AdminTablesController } from './admin-tables.controller';

@Module({
  controllers: [AdminTablesController],
  providers: [AdminTableAllowlist, AdminTableRowsService],
  exports: [AdminTableAllowlist],
})
export class AdminTablesModule {}
