// src/app.module.ts
import { Module } from '@nestjs/common';
import { WatchlistModule } from './features/watchlist/watchlist.module';
import { ActivityModule } from './features/activity/activity.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { QueueModule } from './common/queue/queue.module';
import { GraphModule } from './features/graph/graph.module';
import { ConfigModule } from '@nestjs/config';
import { PackagesModule } from './features/packages/packages.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Loads .env automatically
    }),
    WatchlistModule,
    ActivityModule,
    PrismaModule,
    QueueModule,
    PackagesModule,
    GraphModule
  ],
})
export class AppModule {}
