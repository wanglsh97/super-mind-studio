import type { CreateAgentRunRequest } from '@supermind/sdk'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator'

class SelectAgentSkillDto {
  @IsString()
  @Matches(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
  @MaxLength(64)
  declare name: string
}

export class CreateAgentRunDto implements CreateAgentRunRequest {
  @IsString()
  @MinLength(1)
  @MaxLength(8_000)
  declare input: string

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SelectAgentSkillDto)
  declare skills?: SelectAgentSkillDto[]
}
