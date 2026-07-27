import type { CreateAgentThreadRequest, UpdateAgentThreadRequest } from '@supermind/sdk'
import { Type } from 'class-transformer'
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'

import { AGENT_THREAD_LIST_MAX_PAGE_SIZE, AGENT_THREAD_TITLE_MAX_LENGTH } from '../agent.constants'

export class CreateAgentThreadDto implements CreateAgentThreadRequest {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Matches(/^[a-z0-9][a-z0-9._-]*$/)
  declare model: string

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(AGENT_THREAD_TITLE_MAX_LENGTH)
  declare title?: string
}

export class UpdateAgentThreadDto implements UpdateAgentThreadRequest {
  @IsString()
  @MinLength(1)
  @MaxLength(AGENT_THREAD_TITLE_MAX_LENGTH)
  declare title: string
}

export class ListAgentThreadsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  declare page?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(AGENT_THREAD_LIST_MAX_PAGE_SIZE)
  declare pageSize?: number
}
