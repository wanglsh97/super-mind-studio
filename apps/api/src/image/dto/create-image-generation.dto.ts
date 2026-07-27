import type { ImageModelAlias } from '@supermind/sdk'
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator'

import { IMAGE_MODEL_ALIASES } from '../image.constants'

export class CreateImageGenerationDto {
  @IsIn(IMAGE_MODEL_ALIASES)
  declare model: ImageModelAlias

  @IsString()
  @MinLength(1)
  @MaxLength(4_000)
  declare prompt: string

  @IsOptional()
  @IsString()
  @Matches(/^\d{2,4}x\d{2,4}$/)
  declare size?: string

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  declare count?: number
}
