import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { SbomBuilderService } from '../services/sbom-builder.service';
import { SbomQueryService } from '../services/sbom-query.service';
import { SbomMemgraphService } from '../services/sbom-memgraph.service';
import { SbomGraphService } from '../services/sbom-graph.service';
import { CreateSbomOptionsDto } from '../dto/sbom.dto';
import { DependencyOptimizerService } from '../services/dependency-upgrade.service';


@Controller('sbom')
export class SbomController {
  constructor(
    private readonly sbomBuilderService: SbomBuilderService,
    private readonly sbomQueryService: SbomQueryService,
    private readonly sbomMemgraphService: SbomMemgraphService,
    private readonly sbomGraphService: SbomGraphService,
    private readonly optimizer: DependencyOptimizerService,
  ) {}

  @Get('dep-list/:project_id')
  async getDepList(@Param('project_id') project_id: string) {
    return await this.sbomQueryService.getDepList(project_id);
  }

  @Post('generate-SBOM/:package_id')
  async genSbom(
    @Param('package_id') package_id: string,
    @Query('version') version?: string,
  ) {
    // Generate SBOM synchronously with optional version
    const result = await this.sbomBuilderService.addSbom(package_id, version);
    
    // Store in Memgraph with package name and version
    await this.sbomMemgraphService.createSbom(
      package_id,
      'package',
      'cdxgen',
      result.sbom.metadata,
      result.packageName,
      result.version,
    );
    await this.sbomMemgraphService.importCycloneDxSbom(result.sbom, package_id);
    
    return result.sbom;
  }

  @Post('create-custom')
  async createCustomSbom(@Body() options: CreateSbomOptionsDto) {
    const result = await this.sbomQueryService.createCustomSbom(options);
    
    // Compress if requested
    if (options.compressed) {
      const zlib = await import('zlib');
      const compressed = zlib.brotliCompressSync(JSON.stringify(result));
      return compressed.toString('base64');
    }
    
    return result;
  }

  @Get('flattening-analysis/:project_id')
  async getFlatteningAnalysis(@Param('project_id') projectId: string) {
    return this.optimizer.getFlatteningAnalysis(projectId);
  }

  @Get('dependency-graph/:package_id')
  async getFilteredDependencyGraph(
    @Param('package_id') packageId: string,
    @Query('query') query?: string,
    @Query('scope') scope?: 'direct' | 'all',
    @Query('risk') risk?: 'all' | 'low' | 'medium' | 'high',
    @Query('version') version?: string,
  ) {
    return this.sbomGraphService.getFilteredPackageDependencyGraph(packageId, version, {
      query,
      scope,
      risk,
    });
  }

}
