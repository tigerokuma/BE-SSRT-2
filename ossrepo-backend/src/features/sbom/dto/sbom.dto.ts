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

