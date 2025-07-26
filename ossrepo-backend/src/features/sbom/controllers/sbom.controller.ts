import { Body, Controller, Get, Post, Param, Query } from '@nestjs/common';
import { SbomService } from  '../services/sbom.service';
import { CreateSbomDto } from '../dto/sbom.dto';

@Controller('sbom')
export class SbomController {
  constructor(private readonly sbomService: SbomService) {}
  
  @Get('test-generateSBOM')
  async testGenSbom(@Param() gitUrl: string) {
    return await this.sbomService.addSbom(gitUrl);
  }
}