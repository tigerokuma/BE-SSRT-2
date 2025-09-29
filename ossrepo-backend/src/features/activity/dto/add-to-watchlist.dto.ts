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

export class SuspiciousAuthorTimestampsAlertDto {
  @ApiProperty({
    example: true,
    description: 'Enable/disable suspicious author timestamps alerts',
  })
  @IsBoolean()
  enabled: boolean;
}

export class NewVulnerabilitiesDetectedAlertDto {
  @ApiProperty({
    example: true,
    description: 'Enable/disable new vulnerabilities detected alerts',
  })
  @IsBoolean()
  enabled: boolean;
}

export class HealthScoreDecreasesAlertDto {
  @ApiProperty({
    example: true,
    description: 'Enable/disable health score decreases alerts',
  })
  @IsBoolean()
  enabled: boolean;

  @ApiProperty({
    example: 1.0,
    description:
      'Minimum health score change to trigger alert (0.5 to 5.0 points)',
    required: false,
  })
  @IsNumber()
  @Min(0.5)
  @Max(5)
  @IsOptional()
  minimum_health_change?: number;
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

  @ApiProperty({ type: SuspiciousAuthorTimestampsAlertDto })
  @ValidateNested()
  @Type(() => SuspiciousAuthorTimestampsAlertDto)
  suspicious_author_timestamps: SuspiciousAuthorTimestampsAlertDto;

  @ApiProperty({ type: NewVulnerabilitiesDetectedAlertDto })
  @ValidateNested()
  @Type(() => NewVulnerabilitiesDetectedAlertDto)
  new_vulnerabilities_detected: NewVulnerabilitiesDetectedAlertDto;

  @ApiProperty({ type: HealthScoreDecreasesAlertDto })
  @ValidateNested()
  @Type(() => HealthScoreDecreasesAlertDto)
  health_score_decreases: HealthScoreDecreasesAlertDto;

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

  @ApiProperty({ type: AlertSettingsDto })
  @ValidateNested()
  @Type(() => AlertSettingsDto)
  alerts: AlertSettingsDto;
}
