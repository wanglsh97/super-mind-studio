import { Module } from '@nestjs/common'

import { ObservabilityAdminController } from './observability-admin.controller'
import { TempoTraceStore } from './tempo-trace.store'

@Module({ controllers: [ObservabilityAdminController], providers: [TempoTraceStore] })
export class ObservabilityAdminModule {}
