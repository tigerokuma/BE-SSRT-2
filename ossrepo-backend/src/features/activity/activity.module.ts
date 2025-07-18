import { Module } from '@nestjs/common';
import { ActivityController } from './controllers/activity.controller';
import { ActivityService } from './services/activity.service';
import { GitManagerService } from './services/git-manager.service';
import { HealthAnalysisService } from './services/health-analysis.service';
import { ScorecardService } from './services/scorecard.service';
import { RepositorySetupProcessor } from './processors/repository-setup.processor';
import { RateLimitManagerService } from './services/rate-limit-manager.service';
import { GitHubApiService } from './services/github-api.service';
import { BusFactorService } from './services/bus-factor.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { QueueModule } from '../../common/queue/queue.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    QueueModule,
  ],
  controllers: [ActivityController],
  providers: [
    ActivityService,
    GitManagerService,
    HealthAnalysisService,
    ScorecardService,
    RepositorySetupProcessor,
    RateLimitManagerService,
    GitHubApiService,
    BusFactorService,
  ],
  exports: [ActivityService],
})
export class ActivityModule {} 