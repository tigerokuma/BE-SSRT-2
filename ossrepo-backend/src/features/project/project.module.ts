import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ProjectController } from './controllers/project.controller';
import { ProjectService } from './services/project.service';
import { ProjectRepository } from './repositories/project.repository';
import { ProjectSetupProcessor } from './processors/project-setup.processor';
import { PrismaModule } from 'src/common/prisma/prisma.module';
import { GitHubModule } from 'src/common/github/github.module';
import { WebhookModule } from 'src/common/webhook/webhook.module';

@Module({
  imports: [
    PrismaModule, 
    GitHubModule,
    WebhookModule,
    BullModule.registerQueue({ name: 'project-setup' })
  ],
  controllers: [ProjectController],
  providers: [ProjectService, ProjectRepository, ProjectSetupProcessor],
  exports: [ProjectService],
})
export class ProjectModule {}
