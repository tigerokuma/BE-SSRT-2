// src/features/watchlist/watchlist.module.ts
import { Module } from '@nestjs/common';
import { WatchlistController } from './controllers/watchlist.controller';
import { PackagesController } from './controllers/packages.controller';
import { HistoryController } from './controllers/history.controller';
import { WatchlistService } from './services/watchlist.service';
import { PackagesService } from './services/packages.service';
import { PackageSearchService } from './services/package-search.service';
import { HistoryService } from './services/history.service';
import { WatchlistRepository } from './repositories/watchlist.repository';
import { PackagesRepository } from './repositories/packages.repository';
import { NpmPackagesRepository } from './repositories/npm-packages.repository';
import { GitHubRepositoriesRepository } from './repositories/github-repositories.repository';
import { HistoryRepository } from './repositories/history.repository';
import { GitHubService } from './services/github.service';
import { NPMService } from './services/npm.service';
@Module({
  controllers: [
    WatchlistController,
    PackagesController,
    HistoryController,
  ],
  providers: [
    WatchlistService,
    PackagesService,
    PackageSearchService,
    HistoryService,
    WatchlistRepository,
    PackagesRepository,
    NpmPackagesRepository,
    GitHubRepositoriesRepository,
    HistoryRepository,
    GitHubService,
    NPMService,
  ],
})
export class WatchlistModule {}