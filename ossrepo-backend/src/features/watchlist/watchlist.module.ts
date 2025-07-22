// src/features/watchlist/watchlist.module.ts
import { Module } from '@nestjs/common';
import { WatchlistController } from './controllers/watchlist.controller';
import { HistoryController } from './controllers/history.controller';
import { WatchlistService } from './services/watchlist.service';
import { HistoryService } from './services/history.service';
import { WatchlistRepository } from './repositories/watchlist.repository';
import { HistoryRepository } from './repositories/history.repository';
import { PackagesModule } from '../packages/packages.module';

@Module({
  imports: [
    PackagesModule, // Import the packages module to use its services
  ],
  controllers: [
    WatchlistController,
    HistoryController,
  ],
  providers: [
    WatchlistService,
    HistoryService,
    WatchlistRepository,
    HistoryRepository,
  ],
})
export class WatchlistModule {}