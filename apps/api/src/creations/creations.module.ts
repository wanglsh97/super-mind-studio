import { Module } from '@nestjs/common'

import { AgentModule } from '../agent/agent.module'
import { DatabaseModule } from '../database/database.module'
import { UserAuthModule } from '../user-auth/user-auth.module'

import { CreationRepository } from './creation.repository'
import { CreationsController } from './creations.controller'
import { CreationsService } from './creations.service'
import { WebProjectArchiveValidator } from './web-project-archive.validator'

@Module({
  imports: [DatabaseModule, AgentModule, UserAuthModule],
  controllers: [CreationsController],
  providers: [CreationRepository, CreationsService, WebProjectArchiveValidator],
})
export class CreationsModule {}
