import { IsString, IsOptional, IsUrl, IsEnum, IsObject, ValidateIf } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @ValidateIf((o) => o.repositoryUrl && o.repositoryUrl !== '')
  @IsUrl()
  repositoryUrl?: string;

  @IsOptional()
  @IsString()
  branch?: string;

  @IsString()
  userId: string;

  // New fields for project types
  @IsEnum(['repo', 'file', 'cli'])
  type: 'repo' | 'file' | 'cli';

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsObject()
  packageData?: any; // For file uploads, contains the parsed package.json data

  @IsOptional()
  @IsObject()
  dependencies?: any; // For CLI projects, contains the dependencies list

  @IsOptional()
  @IsString()
  license?: string; // License type or null if no license

  @IsOptional()
  vulnerability_notifications?: { alerts: boolean; slack: boolean; discord: boolean };

  @IsOptional()
  license_notifications?: { alerts: boolean; slack: boolean; discord: boolean };

  @IsOptional()
  health_notifications?: { alerts: boolean; slack: boolean; discord: boolean };
}
