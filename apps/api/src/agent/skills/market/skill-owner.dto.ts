import type { AgentSkillCategory } from '@supermind/sdk'
import { IsIn, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator'

import { SKILL_CATEGORIES } from '../publishing/skill-publishing.service'

export class SubmitSkillDto {
  @IsUUID()
  declare uploadSessionId: string

  @IsString()
  @Matches(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/)
  declare name: string

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  declare title: string

  @IsString()
  @MinLength(1)
  @MaxLength(300)
  declare description: string

  @IsIn(SKILL_CATEGORIES)
  declare category: AgentSkillCategory
}

export class UpdatePublishedSkillDto {
  @IsUUID()
  declare uploadSessionId: string

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  declare title: string

  @IsString()
  @MinLength(1)
  @MaxLength(300)
  declare description: string

  @IsIn(SKILL_CATEGORIES)
  declare category: AgentSkillCategory
}
