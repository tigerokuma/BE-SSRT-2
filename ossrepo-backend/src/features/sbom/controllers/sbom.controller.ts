import { Body, Controller, Get, Post, Param, Query } from '@nestjs/common';
import { SbomService } from  '../services/sbom.service';
import { CreateSbomDto } from '../dto/sbom.dto';

@Controller('sbom')
export class SbomController {
  constructor(private readonly sbomService: SbomService) {}
  
  @Get('test-generate-SBOM')
  async testGenSbom(@Param() gitUrl: string) {
    return await this.sbomService.addSbom("https://github.com/aboutcode-org/scancode-toolkit.git");//gitUrl);
  }
}