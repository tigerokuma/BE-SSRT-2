
// src/app.module.ts
import { Module } from '@nestjs/common';
import { WatchlistModule } from './features/watchlist/watchlist.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { GraphModule } from './features/graph/graph.module';

@Module({
  imports: [
      WatchlistModule,
      PrismaModule,
      GraphModule
  ],
})
export class AppModule {}
