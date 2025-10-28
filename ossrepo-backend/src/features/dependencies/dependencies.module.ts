import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { QueueModule } from '../../common/queue/queue.module';
import { AiModule } from '../../common/ai/ai.module';
import { FastSetupProcessor } from './processors/fast-setup.processor';
import { FullSetupProcessor } from './processors/full-setup.processor';
import { ScorecardPriorityProcessor } from './processors/scorecard-priority.processor';
import { DependencyQueueService } from './services/dependency-queue.service';
import { GitCommitExtractorService } from './services/git-commit-extractor.service';
import { PackageScorecardService } from './services/package-scorecard.service';
import { PackageVulnerabilityService } from './services/package-vulnerability.service';
import { MonthlyCommitsService } from './services/monthly-commits.service';
import { GitHubApiService } from '../activity/services/github-api.service';
import { ActivityAnalysisService } from '../activity/services/activity-analysis.service';
import { GitManagerService } from '../activity/services/git-manager.service';
import { AISummaryService } from '../activity/services/ai-summary.service';

@Module({
  imports: [
    PrismaModule,
    QueueModule,
    AiModule,
  ],
  providers: [
    FastSetupProcessor,
    FullSetupProcessor,
    ScorecardPriorityProcessor,
    DependencyQueueService,
    GitCommitExtractorService,
    PackageScorecardService,
    PackageVulnerabilityService,
    MonthlyCommitsService,
    GitHubApiService,
    ActivityAnalysisService,
    GitManagerService,
    AISummaryService,
  ],
  exports: [
    DependencyQueueService,
  ],
})
export class DependenciesModule {}
