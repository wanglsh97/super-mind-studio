import { Module } from '@nestjs/common'
import { AgentModule } from '../agent/agent.module'
import { DatabaseModule } from '../database/database.module'
import { UserAuthModule } from '../user-auth/user-auth.module'
import { CreationsController } from './creations.controller'
import { CreationRepository } from './creation.repository'
import { CreationsService } from './creations.service'
import { WebProjectArchiveValidator } from './web-project-archive.validator'
import { WebProjectPreviewService } from './web-project-preview.service'

@Module({ imports: [DatabaseModule, AgentModule, UserAuthModule], controllers: [CreationsController], providers: [CreationRepository, CreationsService, WebProjectArchiveValidator, WebProjectPreviewService] })
export class CreationsModule {}
