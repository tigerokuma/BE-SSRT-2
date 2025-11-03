import { IsString, IsOptional, IsJSON, IsDate, IsEnum, IsBoolean, IsArray, IsNumber, Min } from 'class-validator';

export class CreateSbomDto {
  @IsString()
  id: string;

  sbom: any;
}

export class UpdateSbomDto {
  @IsString()
  id: string;

  sbom: any;

  @IsDate()
  updated_at: Date;
}

export class GraphParamsDto {
  @IsString()
  id: string;

  @IsString()
  node_id: string;
}

export class SearchParamsDto {
  @IsString()
  id: string;

  @IsString()
  search: string;
}

export class CreateSbomOptionsDto {
  @IsString()
  project_id: string;

  @IsOptional()
  @IsEnum(['cyclonedx', 'spdx'])
  format?: 'cyclonedx' | 'spdx';

  @IsOptional()
  @IsEnum(['1.4', '1.5'])
  version?: '1.4' | '1.5';

  @IsOptional()
  @IsBoolean()
  include_dependencies?: boolean;

  @IsOptional()
  @IsBoolean()
  include_watchlist_dependencies?: boolean;

  @IsOptional()
  @IsBoolean()
  compressed?: boolean;

  @IsOptional()
  @IsBoolean()
  graph_structure?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  exclude_packages?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  include_extra_packages?: string[];
}
