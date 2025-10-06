import { Module } from '@nestjs/common';
import { ProjectController } from './controllers/project.controller';
import { ProjectService } from './services/project.service';
import { ProjectRepository } from './repositories/project.repository';
import { PrismaModule } from 'src/common/prisma/prisma.module';
import { GitHubModule } from 'src/common/github/github.module';

@Module({
  imports: [PrismaModule, GitHubModule],
  controllers: [ProjectController],
  providers: [ProjectService, ProjectRepository],
  exports: [ProjectService],
})
export class ProjectModule {}
