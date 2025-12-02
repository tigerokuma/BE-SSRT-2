import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { SbomBuilderService } from '../services/sbom-builder.service';
import { SbomMemgraphService } from '../services/sbom-memgraph.service';

@Processor('sbom')
export class SbomProcessor {
  private readonly logger = new Logger(SbomProcessor.name);

  constructor(
    private readonly sbomBuilderService: SbomBuilderService,
    private readonly sbomMemgraphService: SbomMemgraphService,
  ) {}

  @Process('full-process-sbom')
  async fullProcessSbom(job: Job<{ package_id: string; version?: string }>) {
    const { package_id, version } = job.data;
    this.logger.log(`📦 Processing SBOM for package: ${package_id}${version ? `, version: ${version}` : ''}`);
    
    try {
      // Generate SBOM synchronously (same as generate-SBOM endpoint)
      const result = await this.sbomBuilderService.addSbom(package_id, version);
      this.logger.log(`✅ SBOM generated for package: ${result.packageName}@${result.version}`);
      
      // Store in Memgraph (same as generate-SBOM endpoint) with package name and version
      await this.sbomMemgraphService.createSbom(
        package_id,
        'package',
        'cdxgen',
        result.sbom.metadata,
        result.packageName,
        result.version,
      );
      await this.sbomMemgraphService.importCycloneDxSbom(result.sbom, package_id);
      this.logger.log(`✅ SBOM stored in Memgraph for package: ${result.packageName}@${result.version}`);
      
      return { success: true, package_id, version: result.version, sbom: result.sbom };
    } catch (error) {
      this.logger.error(`❌ Failed to process SBOM for package ${package_id}${version ? `, version: ${version}` : ''}:`, error);
      throw error;
    }
  }

}
