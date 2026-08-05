import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

export class CreateWebProjectDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20_000)
  prompt!: string

  @IsOptional()
  @IsString()
  @MaxLength(128)
  model?: string
}
