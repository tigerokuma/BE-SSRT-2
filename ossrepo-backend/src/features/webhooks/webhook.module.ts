import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { PackageChangeDetectorService } from './services/package-change-detector.service';
import { DependencyTrackerService } from './services/dependency-tracker.service';
import { GitHubModule } from '../../common/github/github.module';

@Module({
  imports: [PrismaModule, GitHubModule],
  controllers: [WebhookController],
  providers: [PackageChangeDetectorService, DependencyTrackerService],
})
export class WebhookModule {}
