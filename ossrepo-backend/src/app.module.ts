// src/app.module.ts
import { Module } from '@nestjs/common';
import { WatchlistModule } from './features/watchlist/watchlist.module';
import { PrismaModule } from './common/prisma/prisma.module';

@Module({
  imports: [WatchlistModule, PrismaModule],
})
export class AppModule {}