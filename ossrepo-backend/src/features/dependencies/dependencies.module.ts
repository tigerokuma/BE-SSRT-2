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
import { ContributorProfileUpdaterService } from './services/contributor-profile-updater.service';
import { AnomalyDetectionService } from './services/anomaly-detection.service';
import { PackagePollingProcessor } from './processors/package-polling.processor';
import { GitHubApiService } from '../activity/services/github-api.service';
import { ActivityAnalysisService } from '../activity/services/activity-analysis.service';
import { GitManagerService } from '../activity/services/git-manager.service';
import { AISummaryService } from '../activity/services/ai-summary.service';
import { PackagesModule } from '../packages/packages.module';
import {GraphModule} from "../graph/graph.module";

@Module({
  imports: [
    PrismaModule,
    QueueModule,
    AiModule,
    PackagesModule,
    GraphModule,
  ],
  providers: [
    FastSetupProcessor,
    FullSetupProcessor,
    ScorecardPriorityProcessor,
    PackagePollingProcessor,
    DependencyQueueService,
    GitCommitExtractorService,
    PackageScorecardService,
    PackageVulnerabilityService,
    MonthlyCommitsService,
    ContributorProfileUpdaterService,
    AnomalyDetectionService,
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
