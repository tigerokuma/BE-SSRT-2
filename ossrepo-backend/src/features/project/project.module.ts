import { Module } from '@nestjs/common';
import { ProjectController } from './controllers/project.controller';
import { ProjectService } from './services/project.service';
import { ProjectRepository } from './repositories/project.repository';
import { ProjectSetupProcessor } from './processors/project-setup.processor';
import { PrismaModule } from 'src/common/prisma/prisma.module';
import { GitHubModule } from 'src/common/github/github.module';
import { WebhookModule } from 'src/common/webhook/webhook.module';
import { DependenciesModule } from '../dependencies/dependencies.module';
import { QueueModule } from 'src/common/queue/queue.module';
import { ManualProcessorService } from 'src/common/queue/manual-processor.service';

@Module({
  imports: [
    PrismaModule, 
    GitHubModule,
    WebhookModule,
    DependenciesModule,
    QueueModule
  ],
  controllers: [ProjectController],
  providers: [ProjectService, ProjectRepository, ProjectSetupProcessor, ManualProcessorService],
  exports: [ProjectService],
})
export class ProjectModule {}
