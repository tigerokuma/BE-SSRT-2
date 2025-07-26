import { IsString, IsOptional } from "class-validator";


export class CreateSbomDto {
  @IsString()
  name: string;

  @IsString()
  repositoryUrl: string;

  @IsOptional()
  @IsString()
  description?: string;
}
