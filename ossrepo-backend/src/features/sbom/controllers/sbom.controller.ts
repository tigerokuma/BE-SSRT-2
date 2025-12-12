import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Logger,
} from '@nestjs/common';
import { SbomBuilderService } from '../services/sbom-builder.service';
import { SbomQueryService } from '../services/sbom-query.service';
import { SbomMemgraphService } from '../services/sbom-memgraph.service';
import { SbomGraphService } from '../services/sbom-graph.service';
import { CreateSbomOptionsDto } from '../dto/sbom.dto';
import { DependencyOptimizerService } from '../services/dependency-upgrade.service';


@Controller('sbom')
export class SbomController {
  private readonly logger = new Logger(SbomController.name);

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
    // Get package info to check Memgraph
    const packageInfo = await this.sbomQueryService['sbomRepo'].getPackageById(package_id);
    if (!packageInfo) {
      throw new Error(`Package with ID ${package_id} not found`);
    }

    const packageName = packageInfo.package_name;
    
    // Check if package already exists in Memgraph
    const existsInMemgraph = await this.sbomGraphService.packageExistsInMemgraph(
      packageName,
      version,
    );

    let sbomToImport: any;
    
    if (existsInMemgraph) {
      this.logger.log(`Package ${packageName}${version ? `@${version}` : ''} already exists in Memgraph`);
      // Try to get existing SBOM from database
      try {
        const existingSbom = await this.sbomQueryService['sbomRepo'].getPackageSbom(package_id);
        if (existingSbom) {
          sbomToImport = existingSbom.sbom;
          this.logger.log(`Using existing SBOM from database for dependency task creation`);
        }
      } catch (error) {
        this.logger.warn(`Could not retrieve existing SBOM: ${error}`);
      }
      
      // If no SBOM in database, generate a new one
      if (!sbomToImport) {
        this.logger.log(`No existing SBOM found, generating new one`);
        const result = await this.sbomBuilderService.addSbom(package_id, version);
        sbomToImport = result.sbom;
        
        // Store in Memgraph with package name and version
        await this.sbomMemgraphService.createSbom(
          package_id,
          'package',
          'cdxgen',
          result.sbom.metadata,
          result.packageName,
          result.version,
        );
        await this.sbomMemgraphService.importCycloneDxSbom(sbomToImport, package_id);
      } else {
        // Even if SBOM exists, import it again to create dependency tasks for all elements
        this.logger.log(`Re-importing existing SBOM to create dependency tasks for all elements`);
        await this.sbomMemgraphService.importCycloneDxSbom(sbomToImport, package_id);
      }
    } else {
      // Generate SBOM synchronously with optional version
      const result = await this.sbomBuilderService.addSbom(package_id, version);
      sbomToImport = result.sbom;
      
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
    }
    
    return sbomToImport;
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

  @Get('package-id/:package_name')
  async getPackageId(
    @Param('package_name') packageName: string,
    @Query('version') version?: string,
  ) {
    const packageId = await this.sbomGraphService.getPackageIdByNameAndVersion(
      packageName,
      version,
    );
    return { packageId };
  }

}
