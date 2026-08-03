import { Controller, Get, Inject, NotFoundException, Param, ParseUUIDPipe } from '@nestjs/common'
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger'

import { PrismaService } from '../../database/prisma.service'
import { ADMIN_SESSION_COOKIE } from '../auth/admin-auth.service'
import { TempoTraceStore } from './tempo-trace.store'

@ApiTags('Admin')
@ApiCookieAuth(ADMIN_SESSION_COOKIE)
@Controller('admin/observability')
export class ObservabilityAdminController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(TempoTraceStore) private readonly traces: TempoTraceStore) {}

  @Get('traces/:requestId')
  async trace(@Param('requestId', new ParseUUIDPipe({ version: '4' })) requestId: string) {
    const exists = await this.prisma.requestLog.findUnique({ where: { requestId }, select: { requestId: true } })
    if (!exists) throw new NotFoundException('请求日志不存在')
    return this.traces.findByRequestId(requestId)
  }
}
