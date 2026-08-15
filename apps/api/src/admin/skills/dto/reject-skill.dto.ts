import { IsString, MaxLength, MinLength } from 'class-validator';

import { SKILL_REJECTION_REASON_MAX_LENGTH } from '../admin-skill-review.service';

export class RejectSkillDto {
  @IsString()
  @MinLength(1)
  @MaxLength(SKILL_REJECTION_REASON_MAX_LENGTH)
  declare reason: string;
}
