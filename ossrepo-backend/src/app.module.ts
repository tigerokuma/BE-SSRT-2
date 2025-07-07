// src/app.module.ts
import { Module } from '@nestjs/common';
import { WatchlistModule } from './features/watchlist/watchlist.module';

@Module({
  imports: [WatchlistModule],
})
export class AppModule {}