import { Body, Controller, Get, Post, Param, Query } from '@nestjs/common';
import { SbomBuilderService } from '../services/sbom-builder.service';
import { SbomQueryService } from '../services/sbom-query.service';
import { GraphParamsDto, SearchParamsDto } from '../dto/sbom.dto';

@Controller('sbom')
export class SbomController {
  constructor(
    private readonly sbomBuilderService: SbomBuilderService, 
    private readonly sbomQueryService: SbomQueryService) {}
  
  @Get('dep-list/:user_id')
  async getDepList(@Param('user_id') user_id: string){
    return await this.sbomQueryService.getDepList(user_id);
  }

  @Get('watchlist-metadata/:watchlist_id')
  async getWatchlistMetadataSbom(@Param('watchlist_id') watchlist_id: string) {
    const sbom = (await this.sbomQueryService.getWatchSbom(watchlist_id))?.sbom;
    const sbomText = typeof sbom === 'string' ? sbom : JSON.stringify(sbom);
    return await this.sbomQueryService.getWatchMetadataSbom(sbomText);
  }

  @Get('user-watchlist-metadata/:user_id')
  async getUserWatchlistMetadataSbom(@Param('user_id') user_id: string) {
    const sbom = (await this.sbomQueryService.getUserSbom(user_id))?.sbom;
    const sbomText = typeof sbom === 'string' ? sbom : JSON.stringify(sbom);
    return await this.sbomQueryService.getWatchMetadataSbom(sbomText);
  }

  @Get('graph-dependencies/:watchlist_id/:node_id')
  async getWatchGraphDependencies(@Param() params: GraphParamsDto, @Query('vulns') vulns?: string) {
    const vulnerablePackages = vulns ? vulns.split(',') : [];
    const sbom = (await this.sbomQueryService.getWatchSbom(params.id))?.sbom;
    const sbomText = typeof sbom === 'string' ? sbom : JSON.stringify(sbom);
    return this.sbomQueryService.getNodeDeps(sbomText, params.node_id, vulnerablePackages);
  }

  @Get('user-graph-dependencies/:user_id/:node_id')
  async getUserGraphDependencies(@Param() params: GraphParamsDto, @Query('vulns') vulns?: string) {
    const vulnerablePackages = vulns ? vulns.split(',') : [];
    const sbom = (await this.sbomQueryService.getUserSbom(params.id))?.sbom;
    const sbomText = typeof sbom === 'string' ? sbom : JSON.stringify(sbom);
    const temp =  this.sbomQueryService.getNodeDeps(sbomText, params.node_id, vulnerablePackages);
    return temp;
  }

  @Get('search/:watchlist_id/:search')
  async searchWatchGraphDependencies(@Param() params: SearchParamsDto) {
    const sbom = (await this.sbomQueryService.getWatchSbom(params.id))?.sbom;
    const sbomText = typeof sbom === 'string' ? sbom : JSON.stringify(sbom);
    return this.sbomQueryService.searchNodeDeps(sbomText, params.search);
  }

  @Get('user-search/:user_id/:search')
  async searchUserGraphDependencies(@Param() params: SearchParamsDto) {
    const sbom = (await this.sbomQueryService.getUserSbom(params.id))?.sbom;
    const sbomText = typeof sbom === 'string' ? sbom : JSON.stringify(sbom);
    return this.sbomQueryService.searchNodeDeps(sbomText, params.search);
  }
  
  @Get('watchlist/:watchlist_id')
  async getWatchlistSbom(@Param('watchlist_id') watchlist_id: string) {
    return (await this.sbomQueryService.getWatchSbom(watchlist_id))?.sbom;
  }

  @Get('user-watchlist/:user_id')
  async getUserSbom(@Param('user_id') user_id: string) {
    return (await this.sbomQueryService.getUserSbom(user_id))?.sbom;
  }

  @Post('generate-SBOM/:watchlist_id')
  async genSbom(@Param('watchlist_id') watchlist_id: string) {
    return await this.sbomBuilderService.addSbom(watchlist_id);
  }

  @Post('merge-SBOM/:user_id')
  async mergeSbom(@Param('user_id') user_id: string) {
    return await this.sbomBuilderService.mergeSbom(user_id);
  }
}