import { IsString, IsOptional, IsUrl } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUrl()
  repositoryUrl?: string;

  @IsOptional()
  @IsString()
  branch?: string;

  @IsString()
  userId: string;
}
