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
import { OsvVulnerabilityService } from './services/osv-vulnerability.service';
import { OsvVulnerabilityRepository } from './repositories/osv-vulnerability.repository';
import { PackageVulnerabilityService } from '../dependencies/services/package-vulnerability.service';
import { MonthlyCommitsService } from '../dependencies/services/monthly-commits.service';
import { PackageAlertSettingsService } from './services/package-alert-settings.service';
import { PackageAlertService } from './services/package-alert.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AiModule } from '../../common/ai/ai.module';

@Module({
  imports: [
    PrismaModule, // Import PrismaModule for database access
    AiModule, // Import AiModule for GeminiService
  ],
  controllers: [PackagesController],
  providers: [
    PackagesService,
    PackageSearchService,
    PackagesRepository,
    NpmPackagesRepository,
    GitHubRepositoriesRepository,
    GitHubService,
    NPMService,
    OsvVulnerabilityService,
    OsvVulnerabilityRepository,
    PackageVulnerabilityService,
    MonthlyCommitsService,
    PackageAlertSettingsService,
    PackageAlertService,
  ],
  exports: [
    PackagesService,
    PackageSearchService,
    OsvVulnerabilityService,
    // Export any services that watchlist might need
  ],
})
export class PackagesModule {}
