import { IsNotEmpty, IsString, IsUrl, ValidateNested, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class AlertSettingsDto {
  @ApiProperty({ enum: ['none', 'mild', 'critical'] })
  @IsIn(['none', 'mild', 'critical'])
  large_deletions: string;

  @ApiProperty({ enum: ['none', 'mild', 'critical'] })
  @IsIn(['none', 'mild', 'critical'])
  massive_diffs: string;

  @ApiProperty({ enum: ['none', 'mild', 'critical'] })
  @IsIn(['none', 'mild', 'critical'])
  unusual_author_activity: string;

  @ApiProperty({ enum: ['none', 'mild', 'critical'] })
  @IsIn(['none', 'mild', 'critical'])
  high_churn: string;

  @ApiProperty({ enum: ['none', 'mild', 'critical'] })
  @IsIn(['none', 'mild', 'critical'])
  ancestry_breaks: string;

  @ApiProperty({ enum: ['none', 'mild', 'critical'] })
  @IsIn(['none', 'mild', 'critical'])
  sensitive_file_changes: string;

  @ApiProperty({ enum: ['none', 'mild', 'critical'] })
  @IsIn(['none', 'mild', 'critical'])
  hotfixes: string;

  @ApiProperty({ enum: ['none', 'mild', 'critical'] })
  @IsIn(['none', 'mild', 'critical'])
  suspicious_commit_messages: string;
}

export class AddToWatchlistDto {
  @ApiProperty({ example: 'https://github.com/user/repo' })
  @IsUrl()
  @IsNotEmpty()
  repo_url: string;

  @ApiProperty({ example: 'user-123' })
  @IsString()
  @IsNotEmpty()
  added_by: string;

  @ApiProperty({ type: AlertSettingsDto })
  @ValidateNested()
  @Type(() => AlertSettingsDto)
  alerts: AlertSettingsDto;
} 