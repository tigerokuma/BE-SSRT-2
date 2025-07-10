// src/app.module.ts
import { Module } from '@nestjs/common';
import { WatchlistModule } from './features/watchlist/watchlist.module';
import { AlertModule } from './features/alert/alert.module';
import { PrismaModule } from './common/prisma/prisma.module';

@Module({
  imports: [WatchlistModule, AlertModule, PrismaModule],
})
export class AppModule {}