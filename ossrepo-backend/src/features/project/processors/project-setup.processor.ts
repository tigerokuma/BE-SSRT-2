import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { GitHubService } from '../../../common/github/github.service';
import { WebhookService } from '../../../common/webhook/webhook.service';
import { ProjectRepository } from '../repositories/project.repository';

interface ProjectSetupJobData {
  projectId: string;
  repositoryUrl: string;
}

@Processor('project-setup')
export class ProjectSetupProcessor {
  private readonly logger = new Logger(ProjectSetupProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly githubService: GitHubService,
    private readonly webhookService: WebhookService,
    private readonly projectRepository: ProjectRepository,
  ) {
    this.logger.log('🔧 ProjectSetupProcessor initialized and ready to process jobs');
  }

  @Process('setup-project')
  async handleProjectSetup(job: Job<ProjectSetupJobData>) {
    this.logger.log(`🚀 Processing project setup job: ${job.id} for project ${job.data.projectId}`);
    
    const { projectId, repositoryUrl } = job.data;
    const startTime = Date.now();

    try {
      // Update project status to processing
      await this.projectRepository.updateProjectStatus(projectId, 'creating');

      this.logger.log(`📊 Starting project setup for project ${projectId} with repository: ${repositoryUrl}`);

      // Get the project with its monitored branch to access the branch ID
      const projectWithBranch = await this.projectRepository.getProjectWithBranch(projectId);
      
      if (!projectWithBranch?.monitoredBranch) {
        throw new Error('Project has no monitored branch');
      }

      // Extract dependencies from the repository
      this.logger.log(`📦 Extracting dependencies from ${repositoryUrl}`);
      const dependencies = await this.githubService.extractDependencies(repositoryUrl);
      
      // Store dependencies in the database
      await this.projectRepository.createBranchDependencies(projectWithBranch.monitoredBranch.id, dependencies);
      this.logger.log(`✅ Extracted and stored ${dependencies.length} dependencies`);

      // Setup webhook for the repository
      this.logger.log(`🔗 Setting up webhook for ${repositoryUrl}`);
      await this.webhookService.setupWebhookForRepository(repositoryUrl, projectWithBranch.monitoredBranch.id);
      this.logger.log(`✅ Webhook setup completed`);

      // Update project status to ready
      await this.projectRepository.updateProjectStatus(projectId, 'ready');
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.log(`✅ Project setup completed in ${duration}s for project ${projectId}`);

      return {
        success: true,
        projectId,
        dependenciesCount: dependencies.length,
        duration: `${duration}s`,
      };

    } catch (error) {
      this.logger.error(`❌ Project setup failed for project ${projectId}:`, error.message);
      
      // Update project status to failed with error message
      await this.projectRepository.updateProjectStatus(projectId, 'failed', error.message);
      
      throw error;
    }
  }

}
