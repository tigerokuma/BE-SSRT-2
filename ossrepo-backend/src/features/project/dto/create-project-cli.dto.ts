import { IsString, IsOptional, IsObject } from 'class-validator';

export class CreateProjectCliDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsObject()
  packageJson: any;

  @IsOptional()
  @IsString()
  repositoryUrl?: string;

  @IsOptional()
  @IsString()
  branch?: string;
}
