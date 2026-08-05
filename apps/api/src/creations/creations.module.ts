import { Module } from '@nestjs/common'
import { AgentModule } from '../agent/agent.module'
import { DatabaseModule } from '../database/database.module'
import { UserAuthModule } from '../user-auth/user-auth.module'
import { CreationsController } from './creations.controller'
import { CreationRepository } from './creation.repository'
import { CreationsService } from './creations.service'

@Module({
  imports: [DatabaseModule, AgentModule, UserAuthModule],
  controllers: [CreationsController],
  providers: [CreationRepository, CreationsService],
})
export class CreationsModule {}
