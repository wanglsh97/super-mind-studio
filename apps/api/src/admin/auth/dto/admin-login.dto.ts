import { IsString, MaxLength, MinLength } from 'class-validator';

export class AdminLoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  declare username: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  declare password: string;
}
