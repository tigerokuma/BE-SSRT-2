import { Injectable } from '@nestjs/common';
import { ProjectRepository } from '../repositories/project.repository';
import { CreateProjectDto } from '../dto/create-project.dto';
import { GitHubService } from 'src/common/github/github.service';

@Injectable()
export class ProjectService {
  constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly githubService: GitHubService,
  ) {}

  async createProject(createProjectDto: CreateProjectDto) {
    // First create the project
    const project = await this.projectRepository.createProject(createProjectDto);
    
    // Then associate the user with the project
    await this.projectRepository.createProjectUser(project.id, createProjectDto.userId, 'admin');

    // If repository URL is provided, analyze dependencies and set up webhook
    if (createProjectDto.repositoryUrl) {
      // Get the project with its monitored branch to access the branch ID
      const projectWithBranch = await this.projectRepository.getProjectWithBranch(project.id);
      
      // Try to extract dependencies (don't fail if this doesn't work)
      try {
        const dependencies = await this.githubService.extractDependencies(createProjectDto.repositoryUrl);
        await this.projectRepository.createBranchDependencies(projectWithBranch.monitoredBranch.id, dependencies);
        console.log(`✅ Extracted ${dependencies.length} dependencies`);
      } catch (error) {
        console.log(`⚠️ Could not extract dependencies: ${error.message}`);
        console.log('📝 This is normal for repositories without package.json');
      }
      
      // Always try to set up webhook (independent of dependency extraction)
      try {
        await this.setupRepositoryWebhook(createProjectDto.repositoryUrl, project.id);
      } catch (error) {
        console.error('❌ Error setting up webhook:', error);
        // Don't fail project creation if webhook setup fails
      }
    }

    return project;
  }

  async getProjectsByUserId(userId: string) {
    return this.projectRepository.getProjectsByUserId(userId);
  }

  private async setupRepositoryWebhook(repositoryUrl: string, projectId: string) {
    try {
      console.log(`Setting up webhook for repository: ${repositoryUrl}`);
      
      // Extract owner and repo from GitHub URL
      const match = repositoryUrl.match(/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?(?:\/.*)?$/);
      if (!match) {
        throw new Error(`Invalid GitHub repository URL: ${repositoryUrl}`);
      }

      const [, owner, repo] = match;
      console.log(`Creating webhook for: ${owner}/${repo}`);

      // Get the authenticated Octokit instance
      const octokit = await this.githubService.getAuthenticatedOctokit();
      
      // Create webhook
      const webhookUrl = `${process.env.BACKEND_URL || 'https://3bc645a139d6.ngrok-free.app'}/webhooks/github`;
      
      const webhook = await octokit.repos.createWebhook({
        owner,
        repo,
        config: {
          url: webhookUrl,
          content_type: 'json',
          secret: process.env.GITHUB_WEBHOOK_SECRET || 'your-webhook-secret',
        },
        events: [
          'push',
          'pull_request',
          'release',
          'repository',
        ],
        active: true,
      });

      console.log(`✅ Webhook created successfully for ${owner}/${repo}:`, webhook.data.id);
      
      // Store webhook info in database (you might want to add a webhooks table)
      // For now, just log the success
      return webhook.data;
      
    } catch (error) {
      console.error('Error setting up webhook:', error);
      throw error;
    }
  }

  async getProjectById(projectId: string) {
    return this.projectRepository.getProjectById(projectId);
  }

  async getProjectUsers(projectId: string) {
    return this.projectRepository.getProjectUsers(projectId);
  }

  async getProjectDependencies(projectId: string) {
    const projectWithBranch = await this.projectRepository.getProjectWithBranch(projectId);
    if (!projectWithBranch?.monitoredBranch) {
      throw new Error('Project has no monitored branch');
    }
    return this.projectRepository.getBranchDependencies(projectWithBranch.monitoredBranch.id);
  }


  async refreshProjectDependencies(projectId: string) {
    // Get the project to access its repository URL
    const project = await this.projectRepository.getProjectById(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    // Get the repository URL from the MonitoredBranch
    const projectWithBranch = await this.projectRepository.getProjectWithBranch(projectId);
    if (!projectWithBranch?.monitoredBranch?.repository_url) {
      throw new Error('Project has no repository URL');
    }

    try {
      // Extract dependencies from the repository
      const dependencies = await this.githubService.extractDependencies(projectWithBranch.monitoredBranch.repository_url);
      
      // Clear existing dependencies and add new ones at branch level
      await this.projectRepository.clearBranchDependencies(projectWithBranch.monitoredBranch.id);
      await this.projectRepository.createBranchDependencies(projectWithBranch.monitoredBranch.id, dependencies);
      
      return {
        message: 'Dependencies refreshed successfully',
        dependencies: dependencies,
      };
    } catch (error) {
      console.error('Error refreshing dependencies:', error);
      throw new Error(`Failed to refresh dependencies: ${error.message}`);
    }
  }

  async getUserRoleInProject(projectId: string, userId: string) {
    return this.projectRepository.getUserRoleInProject(projectId, userId);
  }

  async joinProject(projectId: string, userId: string = 'user-abc') {
    // Check if project exists
    const project = await this.projectRepository.getProjectById(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    // Add user to project as a member (non-admin)
    return this.projectRepository.addUserToProject(projectId, userId, 'member');
  }

  async addToProjectWatchlist(projectId: string, userId: string, repoUrl: string, name: string) {
    return this.projectRepository.addToProjectWatchlist(projectId, userId, repoUrl, name);
  }

  async getProjectWatchlist(projectId: string) {
    return this.projectRepository.getProjectWatchlist(projectId);
  }

  async getProjectWatchlistReview(projectWatchlistId: string) {
    return this.projectRepository.getProjectWatchlistReview(projectWatchlistId);
  }

  async addApproval(projectWatchlistId: string, userId: string) {
    return this.projectRepository.addApproval(projectWatchlistId, userId);
  }

  async addDisapproval(projectWatchlistId: string, userId: string) {
    return this.projectRepository.addDisapproval(projectWatchlistId, userId);
  }

  async addComment(projectWatchlistId: string, userId: string, comment: string) {
    return this.projectRepository.addComment(projectWatchlistId, userId, comment);
  }
}
