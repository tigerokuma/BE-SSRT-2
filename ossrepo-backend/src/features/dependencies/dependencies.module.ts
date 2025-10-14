import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { QueueModule } from '../../common/queue/queue.module';
import { FastSetupProcessor } from './processors/fast-setup.processor';
import { ScorecardPriorityProcessor } from './processors/scorecard-priority.processor';
import { DependencyQueueService } from './services/dependency-queue.service';
import { GitHubApiService } from '../activity/services/github-api.service';
import { ActivityAnalysisService } from '../activity/services/activity-analysis.service';

@Module({
  imports: [
    PrismaModule,
    QueueModule,
  ],
  providers: [
    FastSetupProcessor,
    ScorecardPriorityProcessor,
    DependencyQueueService,
    GitHubApiService,
    ActivityAnalysisService,
  ],
  exports: [
    DependencyQueueService,
  ],
})
export class DependenciesModule {}
