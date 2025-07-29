import { Body, Controller, Get, Post, Param, Query } from '@nestjs/common';
import { SbomService } from  '../services/sbom.service';

@Controller('sbom')
export class SbomController {
  constructor(private readonly sbomService: SbomService) {}
  
  @Post('generate-SBOM')
  async genSbom(@Param() watchlist_id: string) {
    return await this.sbomService.addSbom(watchlist_id);
  }

  @Get('watchlist/:watchlist_id')
  async getWatchlistSbom(@Param('watchlist_id') watchlist_id: string) {
    return this.sbomService.getWatchSbom(watchlist_id);
  }

  @Post('merge-SBOM')
  async mergeSbom(@Param() user_id: string) {
    return await this.sbomService.mergeSbom(user_id);
  }

  @Get('user/:user_id')
  async getUserSbom(@Param('user_id') user_id: string) {
    return this.sbomService.getUserSbom(user_id);
  }
}