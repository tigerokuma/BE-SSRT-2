import { IsObject } from 'class-validator';

export class AnalyzeProjectDto {
  @IsObject()
  packageJson: any;
}
