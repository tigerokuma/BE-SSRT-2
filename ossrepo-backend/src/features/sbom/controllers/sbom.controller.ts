import { Body, Controller, Get, Post, Param, Query } from '@nestjs/common';
import { SbomService } from  '../services/sbom.service';

@Controller('sbom')
export class SbomController {
  constructor(private readonly sbomService: SbomService) {}
  
  @Post('generate-SBOM/:watchlist_id')
  async genSbom(@Param('watchlist_id') watchlist_id: string) {
    return await this.sbomService.addSbom(watchlist_id);
  }

  @Get('dep-list/:user_id')
  async getDepList(@Param('user_id') user_id: string){
    console.log(await this.sbomService.getDepList(user_id));
    return await this.sbomService.getDepList(user_id);
  }

  @Get('watchlist-metadata/:watchlist_id')
  async getWatchlistMetadataSbom(@Param('watchlist_id') watchlist_id: string) {
    const sbom = (await this.sbomService.getWatchSbom(watchlist_id))?.sbom;
    const sbomText = typeof sbom === 'string' ? sbom : JSON.stringify(sbom);
    return this.sbomService.getWatchMetadataSbom(sbomText);
  }

  @Get('user-watchlist-metadata/:user_id')
  async getUserWatchlistMetadataSbom(@Param('user_id') user_id: string) {
    const sbom = (await this.sbomService.getUserSbom(user_id))?.sbom;
    const sbomText = typeof sbom === 'string' ? sbom : JSON.stringify(sbom);
    return this.sbomService.getWatchMetadataSbom(sbomText);
  }

  @Get('graph-dependencies/:watchlist_id/:node_id')
  async getWatchGraphDependencies(@Param() params: { watchlist_id: string; node_id: string }, @Query('vulns') vulns?: string) {
    const vulnerablePackages = vulns ? vulns.split(',') : [];
    const sbom = (await this.sbomService.getWatchSbom(params.watchlist_id))?.sbom;
    const sbomText = typeof sbom === 'string' ? sbom : JSON.stringify(sbom);
    return this.sbomService.getNodeDeps(sbomText, params.node_id, vulnerablePackages);
  }

  @Get('user-graph-dependencies/:user_id/:node_id')
  async getUserGraphDependencies(@Param() params: { user_id: string; node_id: string }, @Query('vulns') vulns?: string) {
    const vulnerablePackages = vulns ? vulns.split(',') : [];
    const sbom = (await this.sbomService.getUserSbom(params.user_id))?.sbom;
    const sbomText = typeof sbom === 'string' ? sbom : JSON.stringify(sbom);
    return this.sbomService.getNodeDeps(sbomText, params.node_id, vulnerablePackages);
  }

  @Get('search/:watchlist_id/:search')
  async searchWatchGraphDependencies(@Param() params: { watchlist_id: string; search: string }) {
    const sbom = (await this.sbomService.getWatchSbom(params.watchlist_id))?.sbom;
    const sbomText = typeof sbom === 'string' ? sbom : JSON.stringify(sbom);
    return this.sbomService.searchNodeDeps(sbomText, params.search);
  }

  @Get('user-search/:user_id/:search')
  async searchUserGraphDependencies(@Param() params: { user_id: string; search: string }) {
    const sbom = (await this.sbomService.getUserSbom(params.user_id))?.sbom;
    const sbomText = typeof sbom === 'string' ? sbom : JSON.stringify(sbom);
    return this.sbomService.searchNodeDeps(sbomText, params.search);
  }

  @Get('watchlist/:watchlist_id')
  async getWatchlistSbom(@Param('watchlist_id') watchlist_id: string) {
    return await this.sbomService.getWatchSbom(watchlist_id);
  }

  @Get('user-watchlist/:user_id')
  async getUserSbom(@Param('user_id') user_id: string) {
    return await this.sbomService.getUserSbom(user_id);
  }

  @Post('merge-SBOM/:user_id')
  async mergeSbom(@Param('user_id') user_id: string) {
    return await this.sbomService.mergeSbom(user_id);
  }
}