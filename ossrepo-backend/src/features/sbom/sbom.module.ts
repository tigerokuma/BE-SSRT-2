import { Module } from '@nestjs/common';
import { SbomRepository } from './repositories/sbom.repository';
import { SbomService } from './services/sbom.service';
import { SbomController } from './controllers/sbom.controller';
import { PrismaService } from '../../common/prisma/prisma.service';

@Module({
  providers: [SbomRepository, SbomService, PrismaService],
  controllers: [SbomController],
  exports: [SbomService],
})
export class SbomModule {} 