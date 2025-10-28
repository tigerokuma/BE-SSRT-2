import { Controller, Get, Post, Param } from '@nestjs/common';
import { SbomBuilderService } from '../services/sbom-builder.service';
import { SbomQueryService } from '../services/sbom-query.service';
import { SbomMemgraph } from '../services/sbom-graph-builder.service';

@Controller('sbom')
export class SbomController {
  constructor(
    private readonly sbomBuilderService: SbomBuilderService,
    private readonly sbomQueryService: SbomQueryService,
    private readonly sbomMemgraph: SbomMemgraph,
  ) {}

  @Get('dep-list/:project_id')
  async getDepList(@Param('project_id') project_id: string) {
    return await this.sbomQueryService.getDepList(project_id);
  }

  @Get('package-metadata/:package_id')
  async getPackageMetadataSbom(@Param('package_id') package_id: string) {
    return await this.sbomMemgraph.getWatchSbom(package_id);
  }

  @Get('project-metadata/:project_id')
  async getProjectMetadataSbom(@Param('project_id') project_id: string) {
    return await this.sbomQueryService.getProjectSbom(project_id);
  }

  // @Get('graph-dependencies/:id/:node_id')
  // async getWatchGraphDependencies(
  //   @Param() params: GraphParamsDto,
  //   @Query('vulns') vulns?: string,
  // ) {
  //   const vulnerablePackages = vulns ? vulns.split(',') : [];
  //   const sbom = (await this.sbomQueryService.getWatchSbom(params.id))?.sbom;
  //   const sbomText = typeof sbom === 'string' ? sbom : JSON.stringify(sbom);
  //   return this.sbomQueryService.getNodeDeps(
  //     sbomText,
  //     params.node_id,
  //     vulnerablePackages,
  //   );
  // }

  // @Get('user-graph-dependencies/:id/:node_id')
  // async getUserGraphDependencies(
  //   @Param() params: GraphParamsDto,
  //   @Query('vulns') vulns?: string,
  // ) {
  //   const vulnerablePackages = vulns ? vulns.split(',') : [];
  //   const sbom = (await this.sbomQueryService.getUserSbom(params.id))?.sbom;
  //   const sbomText = typeof sbom === 'string' ? sbom : JSON.stringify(sbom);
  //   const temp = this.sbomQueryService.getNodeDeps(
  //     sbomText,
  //     params.node_id,
  //     vulnerablePackages,
  //   );
  //   return temp;
  // }

  // @Get('search/:id/:search')
  // async searchWatchGraphDependencies(@Param() params: SearchParamsDto) {
  //   const sbom = (await this.sbomQueryService.getWatchSbom(params.id))?.sbom;
  //   const sbomText = typeof sbom === 'string' ? sbom : JSON.stringify(sbom);
  //   return this.sbomQueryService.searchNodeDeps(sbomText, params.search);
  // }

  // @Get('user-search/:id/:search')
  // async searchUserGraphDependencies(@Param() params: SearchParamsDto) {
  //   const sbom = (await this.sbomQueryService.getUserSbom(params.id))?.sbom;
  //   const sbomText = typeof sbom === 'string' ? sbom : JSON.stringify(sbom);
  //   return this.sbomQueryService.searchNodeDeps(sbomText, params.search);
  // }

  // @Get('watchlist/:watchlist_id')
  // async getWatchlistSbom(@Param('watchlist_id') watchlist_id: string) {
  //   return (await this.sbomQueryService.getWatchSbom(watchlist_id))?.sbom;
  // }

  // @Get('user-watchlist/:user_id')
  // async getUserSbom(@Param('user_id') user_id: string) {
  //   return (await this.sbomQueryService.getUserSbom(user_id))?.sbom;
  // }

  @Post('generate-SBOM/:package_id')
  async genSbom(@Param('package_id') package_id: string) {
    // Generate SBOM synchronously
    const sbomJson = await this.sbomBuilderService.addSbom(package_id);
    
    // Store in Memgraph
    await this.sbomMemgraph.createSbom(package_id, 'package', 'cdxgen', sbomJson.metadata);
    await this.sbomMemgraph.importCycloneDxSbom(sbomJson, package_id);
    
    return sbomJson;
  }

  // @Post('merge-SBOM/:project_id')
  // async mergeSbom(@Param('project_id') project_id: string) {
  //   return await this.sbomBuilderService.mergeSbom(project_id);
  // }
}
