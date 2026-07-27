import type { PromptOptimizationMode } from '@supermind/sdk'
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator'

const PROMPT_OPTIMIZATION_MODES = [
  'expand',
  'simplify',
  'structure',
] as const satisfies readonly PromptOptimizationMode[]

export class OptimizePromptDto {
  @IsString()
  @MinLength(1)
  @MaxLength(8_000)
  declare prompt: string

  @IsIn(PROMPT_OPTIMIZATION_MODES)
  declare mode: PromptOptimizationMode
}
