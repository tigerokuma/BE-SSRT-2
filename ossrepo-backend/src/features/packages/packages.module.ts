// src/features/packages/packages.module.ts
import { Module } from '@nestjs/common';
import { PackagesController } from './controllers/packages.controller';
import { PackagesService } from './services/packages.service';
import { PackageSearchService } from './services/package-search.service';
import { PackagesRepository } from './repositories/packages.repository';
import { NpmPackagesRepository } from './repositories/npm-packages.repository';
import { GitHubRepositoriesRepository } from './repositories/github-repositories.repository';
import { GitHubService } from './services/github.service';
import { NPMService } from './services/npm.service';
import { PrismaModule } from '../../common/prisma/prisma.module';

@Module({
  imports: [
    PrismaModule, // Import PrismaModule for database access
  ],
  controllers: [
    PackagesController,
  ],
  providers: [
    PackagesService,
    PackageSearchService,
    PackagesRepository,
    NpmPackagesRepository,
    GitHubRepositoriesRepository,
    GitHubService,
    NPMService,
  ],
  exports: [
    PackagesService,
    PackageSearchService,
    // Export any services that watchlist might need
  ],
})
export class PackagesModule {}