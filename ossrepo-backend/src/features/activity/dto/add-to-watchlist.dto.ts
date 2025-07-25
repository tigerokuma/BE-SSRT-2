import {
  IsNotEmpty,
  IsString,
  IsUrl,
  ValidateNested,
  IsNumber,
  IsBoolean,
  Min,
  Max,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class LinesAddedDeletedAlertDto {
  @ApiProperty({
    example: true,
    description: 'Enable/disable lines added/deleted alerts',
  })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({
    example: 2.5,
    description: 'Standard deviations from contributor normal',
    required: false,
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  contributor_variance?: number;

  @ApiProperty({
    example: 3.0,
    description: 'Standard deviations from repository normal',
    required: false,
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  repository_variance?: number;

  @ApiProperty({
    example: 1000,
    description: 'Hardcoded threshold for lines added/deleted',
    required: false,
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  hardcoded_threshold?: number;
}

export class FilesChangedAlertDto {
  @ApiProperty({
    example: true,
    description: 'Enable/disable files changed alerts',
  })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({
    example: 2.0,
    description: 'Standard deviations from contributor normal',
    required: false,
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  contributor_variance?: number;

  @ApiProperty({
    example: 2.5,
    description: 'Standard deviations from repository normal',
    required: false,
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  repository_variance?: number;

  @ApiProperty({
    example: 20,
    description: 'Hardcoded threshold for number of files changed',
    required: false,
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  hardcoded_threshold?: number;
}

export class HighChurnAlertDto {
  @ApiProperty({
    example: true,
    description: 'Enable/disable high churn alerts',
  })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({
    example: 2.5,
    description: 'Multiplier from typical daily norm',
    required: false,
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  multiplier?: number;

  @ApiProperty({
    example: 10,
    description: 'Hardcoded threshold for number of commits in time period',
    required: false,
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  hardcoded_threshold?: number;
}

export class AncestryBreaksAlertDto {
  @ApiProperty({
    example: true,
    description: 'Whether to alert on history rewrites',
  })
  @IsBoolean()
  enabled: boolean;
}

export class UnusualAuthorActivityAlertDto {
  @ApiProperty({
    example: true,
    description: 'Enable/disable unusual author activity alerts',
  })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({
    example: 80,
    description: 'Percentage outside typical time range',
  })
  @IsNumber()
  @Min(0)
  @Max(100)
  percentage_outside_range: number;
}

export class AIAnomalyDetectionAlertDto {
  @ApiProperty({
    example: true,
    description: 'Enable/disable AI-powered anomaly detection alerts',
  })
  @IsBoolean()
  enabled: boolean;
}

export class AlertSettingsDto {
  @ApiProperty({ type: LinesAddedDeletedAlertDto })
  @ValidateNested()
  @Type(() => LinesAddedDeletedAlertDto)
  lines_added_deleted: LinesAddedDeletedAlertDto;

  @ApiProperty({ type: FilesChangedAlertDto })
  @ValidateNested()
  @Type(() => FilesChangedAlertDto)
  files_changed: FilesChangedAlertDto;

  @ApiProperty({ type: HighChurnAlertDto })
  @ValidateNested()
  @Type(() => HighChurnAlertDto)
  high_churn: HighChurnAlertDto;

  @ApiProperty({ type: AncestryBreaksAlertDto })
  @ValidateNested()
  @Type(() => AncestryBreaksAlertDto)
  ancestry_breaks: AncestryBreaksAlertDto;

  @ApiProperty({ type: UnusualAuthorActivityAlertDto })
  @ValidateNested()
  @Type(() => UnusualAuthorActivityAlertDto)
  unusual_author_activity: UnusualAuthorActivityAlertDto;

  @ApiProperty({ type: AIAnomalyDetectionAlertDto })
  @ValidateNested()
  @Type(() => AIAnomalyDetectionAlertDto)
  ai_powered_anomaly_detection: AIAnomalyDetectionAlertDto;
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

  @ApiProperty({ example: 'Important repository to monitor', required: false })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({ type: AlertSettingsDto })
  @ValidateNested()
  @Type(() => AlertSettingsDto)
  alerts: AlertSettingsDto;
}
