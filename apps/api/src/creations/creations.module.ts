import { Module } from '@nestjs/common'
import { AgentModule } from '../agent/agent.module'
import { DatabaseModule } from '../database/database.module'
import { CreationsController } from './creations.controller'
import { CreationsService } from './creations.service'

@Module({ imports: [DatabaseModule, AgentModule], controllers: [CreationsController], providers: [CreationsService] })
export class CreationsModule {}
