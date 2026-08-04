import type { AgentUserQuestionAnswerItem, AnswerAgentUserQuestionRequest } from '@supermind/sdk'
import { Type } from 'class-transformer'
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator'

class AgentUserQuestionAnswerDto implements AgentUserQuestionAnswerItem {
  @IsUUID()
  declare questionId: string

  @IsArray()
  @ArrayMaxSize(4)
  @IsUUID(undefined, { each: true })
  declare selectedOptionIds: string[]

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  declare customText?: string
}

export class AnswerAgentUserQuestionDto implements AnswerAgentUserQuestionRequest {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => AgentUserQuestionAnswerDto)
  declare answers: AgentUserQuestionAnswerDto[]
}
