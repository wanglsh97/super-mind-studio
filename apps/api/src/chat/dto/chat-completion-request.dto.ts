import type { ChatMessage, TextModelId } from '@supermind/sdk'
import { Type } from 'class-transformer'
import {
  ArrayMinSize,
  ArrayMaxSize,
  Equals,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  Matches,
  ValidateNested,
} from 'class-validator'

export class ChatMessageDto implements ChatMessage {
  @IsIn(['system', 'user', 'assistant'])
  declare role: ChatMessage['role']

  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  declare content: string
}

export class ChatCompletionRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Matches(/^[a-z0-9][a-z0-9._-]*$/)
  declare model: TextModelId

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  declare messages: ChatMessageDto[]

  @IsBoolean()
  @Equals(true)
  declare stream: true

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  declare temperature?: number

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  declare topP?: number

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4096)
  declare maxTokens?: number

  @IsOptional()
  @IsBoolean()
  declare comparison?: boolean
}
