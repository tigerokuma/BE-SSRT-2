import { IsString, IsOptional } from 'class-validator';

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  license?: string;

  @IsOptional()
  vulnerability_notifications?: { alerts: boolean; slack: boolean; discord: boolean };

  @IsOptional()
  license_notifications?: { alerts: boolean; slack: boolean; discord: boolean };

  @IsOptional()
  health_notifications?: { alerts: boolean; slack: boolean; discord: boolean };

  @IsOptional()
  anomalies_notifications?: { alerts: boolean; slack: boolean; discord: boolean };
}
