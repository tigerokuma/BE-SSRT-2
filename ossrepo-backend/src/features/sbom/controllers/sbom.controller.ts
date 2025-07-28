import { Body, Controller, Get, Post, Param, Query } from '@nestjs/common';
import { SbomService } from  '../services/sbom.service';

@Controller('sbom')
export class SbomController {
  constructor(private readonly sbomService: SbomService) {}
  
  @Get('test-generate-SBOM')
  async testGenSbom(@Param() gitUrl: string) {
    return await this.sbomService.addSbom(gitUrl);
  }

  @Get('test-merge-SBOM')
  async testMerSbom(@Param() uwlId: string) {
    return await this.sbomService.mergeSbom(uwlId);
  }
}