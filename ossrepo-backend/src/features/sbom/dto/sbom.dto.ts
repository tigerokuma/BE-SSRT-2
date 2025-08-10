import { IsString, IsOptional, IsJSON, IsDate } from "class-validator";


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

