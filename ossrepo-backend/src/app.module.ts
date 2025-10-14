// src/app.module.ts
import { Module } from '@nestjs/common';
import { WatchlistModule } from './features/watchlist/watchlist.module';
import { ActivityModule } from './features/activity/activity.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { QueueModule } from './common/queue/queue.module';
import { GraphModule } from './features/graph/graph.module';
import { ConfigModule } from '@nestjs/config';
import { PackagesModule } from './features/packages/packages.module';
import { UserModule } from './features/user/user.module';
import { AlertModule } from './features/alert/alert.module';
import { AuthModule } from './features/auth/auth.module';
import { SbomModule } from './features/sbom/sbom.module';
import { ProjectModule } from './features/project/project.module';
import { GitHubModule } from './features/github/github.module';
import { WebhookModule } from './features/webhooks/webhook.module';
import { DependenciesModule } from './features/dependencies/dependencies.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true, // Loads .env automatically
    }),
    ConfigModule,
    PackagesModule,
    WatchlistModule,
    AlertModule,
    SbomModule,
    PrismaModule,
    GraphModule,
    UserModule,
    AuthModule,
    QueueModule,
    ActivityModule,
    ProjectModule,
    GitHubModule,
    WebhookModule,
    DependenciesModule,
  ],
})
export class AppModule {}
