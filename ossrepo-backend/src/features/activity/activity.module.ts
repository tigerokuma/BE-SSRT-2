import { Module } from '@nestjs/common';
import { ActivityController } from './controllers/activity.controller';
import { ActivityService } from './services/activity.service';
import { GitManagerService } from './services/git-manager.service';
import { HealthAnalysisService } from './services/health-analysis.service';
import { RepositorySetupProcessor } from './processors/repository-setup.processor';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { QueueModule } from '../../common/queue/queue.module';

@Module({
  imports: [PrismaModule, QueueModule],
  controllers: [ActivityController],
  providers: [
    ActivityService,
    GitManagerService,
    HealthAnalysisService,
    RepositorySetupProcessor,
  ],
  exports: [ActivityService],
})
export class ActivityModule {} 