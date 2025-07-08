// src/features/watchlist/watchlist.module.ts
import { Module } from '@nestjs/common';
import { WatchlistController } from './controllers/watchlist.controller';
import { PackagesController } from './controllers/packages.controller';
import { HistoryController } from './controllers/history.controller';
import { WatchlistService } from './services/watchlist.service';
import { PackagesService } from './services/packages.service';
import { HistoryService } from './services/history.service';
import { WatchlistRepository } from './repositories/watchlist.repository';
import { PackagesRepository } from './repositories/packages.repository';
import { HistoryRepository } from './repositories/history.repository';
import { GitHubService } from './services/github.service';
@Module({
  controllers: [
    WatchlistController,
    PackagesController,
    HistoryController,
  ],
  providers: [
    WatchlistService,
    PackagesService,
    HistoryService,
    WatchlistRepository,
    PackagesRepository,
    HistoryRepository,
    GitHubService,
  ],
})
export class WatchlistModule {}