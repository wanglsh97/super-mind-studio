import type { CreateSkillUploadSessionRequest } from '@supermind/sdk'
import { IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator'

import { MAX_SKILL_PACKAGE_BYTES } from '../skills/upload/skill-upload-session.service'

export class CreateSkillUploadSessionDto implements CreateSkillUploadSessionRequest {
  @IsInt()
  @Min(1)
  @Max(MAX_SKILL_PACKAGE_BYTES)
  declare sizeBytes: number

  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  declare sha256: string

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/)
  declare skillName?: string
}
