import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { SbomRepository } from './repositories/sbom.repository';
import { SbomBuilderService } from './services/sbom-builder.service';
import { SbomQueryService } from './services/sbom-query.service';
import { SbomQueueService } from './services/sbom-queue.service';
import { SbomController } from './controllers/sbom.controller';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QueueModule } from 'src/common/queue/queue.module';
import { SbomProcessor } from './processors/sbom.processor';
import { SbomMemgraph } from './services/sbom-graph-builder.service';
import { DependencyOptimizerService } from './services/dependency-upgrade.service';

@Module({
  imports: [BullModule.registerQueue({ name: 'sbom' })],
  providers: [
    SbomRepository,
    SbomBuilderService,
    SbomQueryService,
    SbomQueueService,
    SbomProcessor,
    QueueModule,
    PrismaService,
    SbomMemgraph,
    DependencyOptimizerService,
  ],
  controllers: [SbomController],
  exports: [SbomBuilderService, SbomQueryService, SbomQueueService],
})
export class SbomModule {}
