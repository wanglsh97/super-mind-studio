import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';

import { ADMIN_SESSION_COOKIE } from '../auth/admin-auth.service';
import { AdminTableAllowlist } from './admin-table-allowlist';
import { AdminTableRowsService } from './admin-table-rows.service';
import { AdminTableRowsQueryDto } from './dto/admin-table-rows-query.dto';

@ApiTags('Admin')
@ApiCookieAuth(ADMIN_SESSION_COOKIE)
@Controller('admin/tables')
export class AdminTablesController {
  constructor(
    @Inject(AdminTableAllowlist) private readonly allowlist: AdminTableAllowlist,
    @Inject(AdminTableRowsService) private readonly rows: AdminTableRowsService,
  ) {}

  @Get()
  list() {
    return this.allowlist.list();
  }

  @Get('schema')
  schema() {
    return this.allowlist.schema();
  }

  @Get(':table/rows')
  listRows(@Param('table') table: string, @Query() query: AdminTableRowsQueryDto) {
    return this.rows.list(table, query);
  }
}
