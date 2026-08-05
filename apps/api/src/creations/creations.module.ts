import { Module } from '@nestjs/common'
import { AgentModule } from '../agent/agent.module'
import { DatabaseModule } from '../database/database.module'
import { CreationsController } from './creations.controller'
import { CreationsService } from './creations.service'
import { WebProjectArchiveValidator } from './web-project-archive.validator'
import { WebProjectPreviewService } from './web-project-preview.service'

@Module({ imports: [DatabaseModule, AgentModule], controllers: [CreationsController], providers: [CreationsService, WebProjectArchiveValidator, WebProjectPreviewService] })
export class CreationsModule {}
