import { Module, forwardRef } from '@nestjs/common';
import { SbomRepository } from './repositories/sbom.repository';
import { SbomBuilderService } from './services/sbom-builder.service';
import { SbomQueryService } from './services/sbom-query.service';
import { SbomQueueService } from './services/sbom-queue.service';
import { SbomController } from './controllers/sbom.controller';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QueueModule } from 'src/common/queue/queue.module';
import { SbomProcessor } from './processors/sbom.processor';
import { DependencyOptimizerService } from './services/dependency-upgrade.service';
import { AzureModule } from '../../common/azure/azure.module';
// New reorganized services
import { SbomGenerationService } from './services/sbom-generation.service';
import { SbomMemgraphService } from './services/sbom-memgraph.service';
import { SbomGraphService } from './services/sbom-graph.service';
import { DependenciesModule } from '../dependencies/dependencies.module';

@Module({
  imports: [
    QueueModule,
    AzureModule,
    forwardRef(() => DependenciesModule),
  ],
  providers: [
    SbomRepository,
    // New reorganized services (must be before old ones for dependency injection)
    SbomGenerationService,
    SbomMemgraphService,
    SbomGraphService,
    // Legacy services (kept for backward compatibility)
    SbomBuilderService,
    SbomQueryService,
    SbomQueueService,
    SbomProcessor,
    PrismaService,
    DependencyOptimizerService,
  ],
  controllers: [SbomController],
  exports: [
    SbomQueueService, 
    SbomBuilderService, 
    SbomQueryService,
    // Export new services
    SbomGenerationService,
    SbomMemgraphService,
    SbomGraphService,
  ],
})
export class SbomModule {}
