import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { GitHubService } from '../../../common/github/github.service';
import { GitHubAppService } from '../../../common/github/github-app.service';
import { WebhookService } from '../../../common/webhook/webhook.service';
import { ProjectRepository } from '../repositories/project.repository';
import { DependencyQueueService } from '../../dependencies/services/dependency-queue.service';

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
    private readonly githubAppService: GitHubAppService,
    private readonly webhookService: WebhookService,
    private readonly projectRepository: ProjectRepository,
    private readonly dependencyQueueService: DependencyQueueService,
  ) {
    this.logger.log('🔧 ProjectSetupProcessor initialized and ready to process jobs');
  }

  @Process('setup-project')
  async handleProjectSetup(job: Job<ProjectSetupJobData>) {
    const { projectId, repositoryUrl } = job.data;
    const startTime = Date.now();

    try {
      // Update project status to processing
      await this.projectRepository.updateProjectStatus(projectId, 'creating');

      this.logger.log(`🚀 Starting project setup for project ${projectId}`);

      // Get the project with its monitored branch to access the branch ID
      const projectWithBranch = await this.projectRepository.getProjectWithBranch(projectId);
      
      if (!projectWithBranch?.monitoredBranch) {
        throw new Error('Project has no monitored branch');
      }

      // Get the project creator's user_id to use their GitHub token
      const projectUsers = await this.prisma.projectUser.findMany({
        where: { project_id: projectId, role: 'admin' },
        select: { user_id: true }
      });
      
      const userId = projectUsers.length > 0 ? projectUsers[0].user_id : undefined;
      
      // Extract dependencies from the repository
      const dependencies = await this.githubService.extractDependencies(repositoryUrl, userId);
      
      // Clear any existing dependencies (including old devDependencies) and store new ones
      await this.projectRepository.clearBranchDependencies(projectWithBranch.monitoredBranch.id);
      const createdDependencies = await this.projectRepository.createBranchDependenciesWithReturn(projectWithBranch.monitoredBranch.id, dependencies);
      this.logger.log(`📦 Extracted ${dependencies.length} production dependencies (cleared any existing devDependencies)`);

      // If there are no dependencies, mark project as ready immediately with perfect health score
      if (createdDependencies.length === 0) {
        this.logger.log(`📭 No dependencies found - marking project as ready immediately with health score 100`);
        await this.prisma.project.update({
          where: { id: projectId },
          data: {
            status: 'ready',
            health_score: 100, // Perfect score for projects with no dependencies
          },
        });
      } else {
        // Queue dependency-fast-setup jobs for each dependency
        for (const branchDependency of createdDependencies) {
          // Try to find the repository URL for this dependency
          let repoUrl: string | undefined;
          try {
            repoUrl = await this.findRepositoryUrl(branchDependency.name);
            if (repoUrl) {
              this.logger.log(`🔍 Found repository URL for ${branchDependency.name}: ${repoUrl}`);
            } else {
              this.logger.log(`⚠️ No repository URL found for ${branchDependency.name}`);
            }
          } catch (error) {
            this.logger.log(`⚠️ Error finding repository URL for ${branchDependency.name}: ${error.message}`);
          }

          await this.dependencyQueueService.queueFastSetup({
            branchDependencyId: branchDependency.id,
            branchId: projectWithBranch.monitoredBranch.id,
            projectId: projectId,
            packageName: branchDependency.name,
            repoUrl: repoUrl,
          });
          this.logger.log(`📋 Queued fast-setup job for dependency: ${branchDependency.name}`);
        }
        
        // Keep project status as 'creating' - dependency jobs will mark it as 'ready' when complete
        this.logger.log(`⏳ Project setup initiated, waiting for ${dependencies.length} dependencies to be analyzed`);
      }

      // Setup webhook for the repository using the project creator's token
      await this.webhookService.setupWebhookForRepository(repositoryUrl, projectWithBranch.monitoredBranch.id, userId);
      this.logger.log(`🔗 Set up webhook`);

      // Check if GitHub App is already installed on this repository and link it
      try {
        const installationId = await this.githubAppService.findInstallationForRepository(repositoryUrl);
        if (installationId) {
          await this.prisma.project.update({
            where: { id: projectId },
            data: {
              github_app_installation_id: installationId,
              github_actions_enabled: true,
            },
          });
          this.logger.log(`✅ Linked GitHub App installation ${installationId} to project ${projectId}`);
        } else {
          this.logger.log(`ℹ️ No GitHub App installation found for repository ${repositoryUrl}`);
        }
      } catch (error) {
        this.logger.warn(`⚠️ Could not check for GitHub App installation: ${error.message}`);
        // Don't fail the project setup if this fails
      }
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.log(`✅ Finished project setup in ${duration}s`);

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

  private async findRepositoryUrl(packageName: string): Promise<string | undefined> {
    try {
      // Query npm registry API to get package info
      const npmUrl = `https://registry.npmjs.org/${packageName}`;
      const response = await fetch(npmUrl);
      
      if (!response.ok) {
        this.logger.log(`⚠️ NPM API returned ${response.status} for ${packageName}`);
        return undefined;
      }
      
      const packageData = await response.json();
      
      // Look for repository URL in the package data
      const repository = packageData.repository;
      if (repository && repository.url) {
        let repoUrl = repository.url;
        
        // Clean up the URL (remove .git suffix, handle git+https:// format)
        if (repoUrl.startsWith('git+https://')) {
          repoUrl = repoUrl.replace('git+https://', 'https://');
        }
        if (repoUrl.startsWith('git+ssh://')) {
          repoUrl = repoUrl.replace('git+ssh://git@', 'https://');
        }
        if (repoUrl.endsWith('.git')) {
          repoUrl = repoUrl.replace('.git', '');
        }
        
        // Ensure it's a GitHub URL
        if (repoUrl.includes('github.com')) {
          this.logger.log(`✅ Found GitHub repository for ${packageName}: ${repoUrl}`);
          return repoUrl;
        } else {
          this.logger.log(`⚠️ Repository for ${packageName} is not on GitHub: ${repoUrl}`);
          return undefined;
        }
      } else {
        this.logger.log(`⚠️ No repository URL found in package data for ${packageName}`);
        return undefined;
      }
    } catch (error) {
      this.logger.log(`❌ Error fetching repository URL for ${packageName}: ${error.message}`);
      return undefined;
    }
  }

}
