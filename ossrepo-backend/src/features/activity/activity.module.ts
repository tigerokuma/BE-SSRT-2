import { Module } from '@nestjs/common';
import { ActivityController } from './controllers/activity.controller';
import { ActivityService } from './services/activity.service';
import { GitManagerService } from './services/git-manager.service';
import { HealthAnalysisService } from './services/health-analysis.service';
import { RepositorySetupProcessor } from './processors/repository-setup.processor';
import { PollingProcessor } from './processors/polling.processor';
import { VulnerabilityCheckProcessor } from './processors/vulnerability-check.processor';
import { HealthCheckProcessor } from './processors/health-check.processor';

import { GitHubApiService } from './services/github-api.service';
import { BusFactorService } from './services/bus-factor.service';
import { ActivityAnalysisService } from './services/activity-analysis.service';
import { AISummaryService } from './services/ai-summary.service';
import { RepositorySummaryService } from './services/repository-summary.service';
import { AlertingService } from './services/alerting.service';
import { AIAnomalyDetectionService } from './services/ai-anomaly-detection.service';
import { VulnerabilityService } from './services/vulnerability.service';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { QueueModule } from '../../common/queue/queue.module';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';

import { SbomModule } from '../sbom/sbom.module';
import { AlertModule } from '../alert/alert.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    QueueModule,
    HttpModule,
    SbomModule,
    AlertModule,
  ],
  controllers: [ActivityController],
  providers: [
    ActivityService,
    GitManagerService,
    HealthAnalysisService,
    RepositorySetupProcessor,
            PollingProcessor,
        VulnerabilityCheckProcessor,
        HealthCheckProcessor,

    GitHubApiService,
    BusFactorService,
    ActivityAnalysisService,
    AISummaryService,
    RepositorySummaryService,
    AlertingService,
    AIAnomalyDetectionService,
    VulnerabilityService,
  ],
  exports: [ActivityService, AISummaryService, RepositorySummaryService],
})
export class ActivityModule {}
