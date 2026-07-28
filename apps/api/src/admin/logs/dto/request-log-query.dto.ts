import { Type } from 'class-transformer'
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator'

export const REQUEST_LOG_CAPABILITIES = ['chat', 'image', 'prompt'] as const
export const REQUEST_LOG_STATUSES = ['pending', 'succeeded', 'failed', 'cancelled'] as const
export const AUTH_PROVIDERS = ['ANONYMOUS', 'GITHUB', 'GOOGLE'] as const
export const REQUEST_LOG_MODELS = [
  'qwen',
  'glm',
  'deepseek',
  'kimi',
  'mock-image',
] as const

export class RequestLogQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  declare page?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  declare pageSize?: number

  @IsOptional()
  @IsISO8601({ strict: true })
  declare from?: string

  @IsOptional()
  @IsISO8601({ strict: true })
  declare to?: string

  @IsOptional()
  @IsIn(REQUEST_LOG_CAPABILITIES)
  declare capability?: (typeof REQUEST_LOG_CAPABILITIES)[number]

  @IsOptional()
  @IsIn(REQUEST_LOG_MODELS)
  declare model?: (typeof REQUEST_LOG_MODELS)[number]

  @IsOptional()
  @IsIn(REQUEST_LOG_STATUSES)
  declare status?: (typeof REQUEST_LOG_STATUSES)[number]

  @IsOptional()
  @IsUUID()
  declare requestId?: string

  @IsOptional()
  @IsIn(AUTH_PROVIDERS)
  declare authProvider?: (typeof AUTH_PROVIDERS)[number]

  @IsOptional()
  @MaxLength(255)
  declare userName?: string

  @IsOptional()
  @MaxLength(255)
  @Matches(/^[^\p{Cc}]+$/u)
  declare providerUserId?: string
}
