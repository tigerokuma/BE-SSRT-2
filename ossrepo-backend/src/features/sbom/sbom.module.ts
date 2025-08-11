import { Module } from '@nestjs/common';
import { SbomRepository } from './repositories/sbom.repository';
import { SbomBuilderService } from './services/sbom-builder.service';
import { SbomQueryService } from './services/sbom-query.service';
import { SbomController } from './controllers/sbom.controller';
import { PrismaService } from '../../common/prisma/prisma.service';

@Module({
  providers: [SbomRepository, SbomBuilderService, SbomQueryService, PrismaService],
  controllers: [SbomController],
  exports: [SbomBuilderService, SbomQueryService],
})
export class SbomModule {} 