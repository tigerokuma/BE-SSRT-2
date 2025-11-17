import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { SbomBuilderService } from '../services/sbom-builder.service';
import { SbomQueryService } from '../services/sbom-query.service';
import { SbomMemgraph } from '../services/sbom-graph-builder.service';
import { CreateSbomOptionsDto } from '../dto/sbom.dto';
import { DependencyOptimizerService } from '../services/dependency-upgrade.service';


@Controller('sbom')
export class SbomController {
  constructor(
    private readonly sbomBuilderService: SbomBuilderService,
    private readonly sbomQueryService: SbomQueryService,
    private readonly sbomMemgraph: SbomMemgraph,
    private readonly optimizer: DependencyOptimizerService,
  ) {}

  @Get('dep-list/:project_id')
  async getDepList(@Param('project_id') project_id: string) {
    return await this.sbomQueryService.getDepList(project_id);
  }

  @Get('package-metadata/:package_id')
  async getPackageMetadataSbom(@Param('package_id') package_id: string) {
    return await this.sbomMemgraph.createDependencySbom(package_id);
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

  @Post('sbom/create-custom')
  async createCustomSbom(@Body() options: CreateSbomOptionsDto) {
    const result = await this.sbomMemgraph.createCustomSbom(options);
    
    // Compress if requested
    if (options.compressed) {
      const zlib = await import('zlib');
      const compressed = zlib.brotliCompressSync(JSON.stringify(result));
      return compressed.toString('base64');
    }
    
    return result;
  }

  // @Post('merge-SBOM/:project_id')
  // async mergeSbom(@Param('project_id') project_id: string) {
  //   return await this.sbomBuilderService.mergeSbom(project_id);
  // }

  @Post('recommendations/:project_id')
  async getRecommendations(@Param('project_id') project_id: string) {
    return this.optimizer.getUpgradeRecommendations(project_id);
  }

  @Get('low-similarity/:project_id')
  async getLowSimilarityPackages(
    @Param('project_id') projectId: string,
    @Query('sharedThreshold') sharedThreshold?: string,
    @Query('similarityRatio') similarityRatio?: string,
    @Query('limit') limit?: string,
  ) {
    return this.optimizer.findLowSimilarityPackages(projectId, {
      sharedThreshold:
        sharedThreshold !== undefined ? Number(sharedThreshold) : undefined,
      similarityRatio:
        similarityRatio !== undefined ? Number(similarityRatio) : undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
  }

  @Get('vulnerable-packages/:project_id')
  async getPackagesWithVulnerabilities(
    @Param('project_id') projectId: string,
    @Query('includePatched') includePatched?: string,
    @Query('minSeverity') minSeverity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
    @Query('limit') limit?: string,
  ) {
    return this.optimizer.findPackagesWithVulnerabilities(projectId, {
      includePatched:
        includePatched !== undefined
          ? includePatched === 'true'
          : undefined,
      minSeverity: minSeverity || undefined,
      limit: limit !== undefined ? Number(limit) : undefined,
    });
  }

  @Get('flattening-analysis/:project_id')
  async getFlatteningAnalysis(@Param('project_id') projectId: string) {
    return this.optimizer.getFlatteningAnalysis(projectId);
  }

  @Get('upgrade-graph/:project_id')
  async getUpgradeDependencyGraph(
    @Param('project_id') projectId: string,
    @Query('packageName') packageName: string,
    @Query('oldVersion') oldVersion: string,
    @Query('newVersion') newVersion: string,
  ) {
    if (!packageName || !oldVersion || !newVersion) {
      throw new BadRequestException(
        'packageName, oldVersion, and newVersion are required',
      );
    }
    return this.optimizer.getUpgradeDependencyGraph(
      projectId,
      packageName,
      oldVersion,
      newVersion,
    );
  }

}
