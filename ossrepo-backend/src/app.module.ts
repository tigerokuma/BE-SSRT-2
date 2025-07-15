// src/app.module.ts
import { Module } from '@nestjs/common';
import { WatchlistModule } from './features/watchlist/watchlist.module';
import { ActivityModule } from './features/activity/activity.module';
import { PrismaModule } from './common/prisma/prisma.module';

@Module({
  imports: [WatchlistModule, ActivityModule, PrismaModule],
})
export class AppModule {}