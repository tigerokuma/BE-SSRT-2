import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ProjectRepository } from '../repositories/project.repository';
import { CreateProjectDto } from '../dto/create-project.dto';
import { CreateProjectCliDto } from '../dto/create-project-cli.dto';
import { AnalyzeProjectDto } from '../dto/analyze-project.dto';
import { GitHubService } from 'src/common/github/github.service';
import { WebhookService } from 'src/common/webhook/webhook.service';
import { PrismaService } from 'src/common/prisma/prisma.service';

@Injectable()
export class ProjectService {
  constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly githubService: GitHubService,
    private readonly webhookService: WebhookService,
    private readonly prisma: PrismaService,
    @InjectQueue('project-setup') private readonly projectSetupQueue: Queue,
  ) {}

  async createProject(createProjectDto: CreateProjectDto) {
    try {
      console.log('ProjectService: Creating project of type:', createProjectDto.type);
      
      // First create the project
      const project = await this.projectRepository.createProject(createProjectDto);
    
    // Then associate the user with the project
    await this.projectRepository.createProjectUser(project.id, createProjectDto.userId, 'admin');

    // Handle different project types
    if (createProjectDto.type === 'repo' && createProjectDto.repositoryUrl) {
      // For repo projects, queue the setup work
      await this.projectSetupQueue.add('setup-project', {
        projectId: project.id,
        repositoryUrl: createProjectDto.repositoryUrl,
      });
    } else {
      // For file and CLI projects, mark as ready immediately
      await this.projectRepository.updateProjectStatus(project.id, 'ready');
    }

      return project; // Returns immediately with status: "creating" for repo projects, "ready" for others
    } catch (error) {
      console.error('Error creating project:', error);
      throw error;
    }
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
    return this.projectRepository.getProjectWithBranch(projectId);
  }

  async getProjectProgress(projectId: string) {
    const project = await this.projectRepository.getProjectWithBranch(projectId);
    if (!project?.monitoredBranch) {
      return { progress: 0, totalDependencies: 0, completedDependencies: 0 };
    }

    const dependencies = await this.projectRepository.getBranchDependencies(project.monitoredBranch.id);
    const completedDependencies = dependencies.filter(dep => 
      dep.package_id && dep.package && dep.package.status === 'done'
    );

    const progress = dependencies.length > 0 
      ? Math.round((completedDependencies.length / dependencies.length) * 100)
      : 0;

    return {
      progress,
      totalDependencies: dependencies.length,
      completedDependencies: completedDependencies.length
    };
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

  async updateWatchlistPackageStatus(watchlistId: string, status: string, userId?: string) {
    return this.projectRepository.updateWatchlistPackageStatus(watchlistId, status, userId);
  }

  async addWatchlistComment(watchlistId: string, userId: string, comment: string) {
    return this.projectRepository.addWatchlistComment(watchlistId, userId, comment);
  }

  // REMOVED: Old watchlist approval/comment methods - replaced with new Packages system

  async updateProject(projectId: string, updateProjectDto: any) {
    return this.projectRepository.updateProject(projectId, updateProjectDto);
  }

  // CLI-specific methods
  async createProjectFromCli(createProjectCliDto: CreateProjectCliDto) {
    // Create MonitoredBranch - use actual repository URL if available, otherwise create dummy
    const repositoryUrl = createProjectCliDto.repositoryUrl || `cli://${createProjectCliDto.name}`;
    const branchName = createProjectCliDto.branch || 'main';
    
    const monitoredBranch = await this.prisma.monitoredBranch.create({
      data: {
        repository_url: repositoryUrl,
        branch_name: branchName,
        is_active: true
      }
    });

    // Create the project
    const project = await this.prisma.project.create({
      data: {
        name: createProjectCliDto.name,
        description: createProjectCliDto.description,
        type: 'cli',
        language: 'nodejs', // Default for CLI projects
        license: createProjectCliDto.license,
        monitored_branch_id: monitoredBranch.id
      }
    });

    // Associate the project with the existing user-123
    await this.projectRepository.createProjectUser(project.id, 'user-123', 'admin');

    // Extract dependencies from package.json and store them
    const dependencies = this.extractDependenciesFromPackageJson(createProjectCliDto.packageJson);
    if (dependencies.length > 0) {
      await this.projectRepository.createBranchDependencies(monitoredBranch.id, dependencies);
    }

    // If it's a real GitHub repository, try to set up webhook
    if (createProjectCliDto.repositoryUrl && createProjectCliDto.repositoryUrl.includes('github.com')) {
      try {
        await this.setupRepositoryWebhook(createProjectCliDto.repositoryUrl, project.id);
        console.log(`✅ GitHub webhook setup for ${createProjectCliDto.repositoryUrl}`);
      } catch (error) {
        console.log(`⚠️ Could not set up GitHub webhook: ${error.message}`);
      }
    }

    return project;
  }

  private extractDependenciesFromPackageJson(packageJson: any): { name: string; version: string }[] {
    const dependencies: { name: string; version: string }[] = [];
    
    // Extract from dependencies
    if (packageJson.dependencies) {
      Object.entries(packageJson.dependencies).forEach(([name, version]) => {
        dependencies.push({ name, version: version as string });
      });
    }
    
    // Extract from devDependencies
    if (packageJson.devDependencies) {
      Object.entries(packageJson.devDependencies).forEach(([name, version]) => {
        dependencies.push({ name, version: version as string });
      });
    }
    
    return dependencies;
  }

  async getProjectsForCli() {
    // Return projects that can be accessed via CLI
    return this.projectRepository.getProjectsForCli();
  }

  async analyzeProjectHealth(projectId: string, analyzeProjectDto: AnalyzeProjectDto) {
    // Get the project's dependencies from the database
    const projectWithBranch = await this.projectRepository.getProjectWithBranch(projectId);
    if (!projectWithBranch?.monitoredBranch) {
      throw new Error('Project has no monitored branch');
    }

    const dependencies = await this.projectRepository.getBranchDependencies(projectWithBranch.monitoredBranch.id);
    
    // Extract dependencies from the provided package.json for comparison
    const packageJsonDeps = this.extractDependenciesFromPackageJson(analyzeProjectDto.packageJson);
    
    // Update dependencies if package.json has changed
    if (packageJsonDeps.length > 0) {
      await this.projectRepository.clearBranchDependencies(projectWithBranch.monitoredBranch.id);
      await this.projectRepository.createBranchDependencies(projectWithBranch.monitoredBranch.id, packageJsonDeps);
    }

    // Mock vulnerability data (in reality, you'd query your vulnerability database)
    const vulnerabilities = [
      {
        package: 'lodash',
        severity: 'high',
        description: 'Prototype pollution vulnerability'
      }
    ];

    // Mock outdated packages (in reality, you'd check against npm registry)
    const outdated = [
      {
        name: 'react',
        current: '17.0.0',
        latest: '18.2.0'
      }
    ];

    // Calculate health score
    const securityScore = Math.max(0, 100 - (vulnerabilities.length * 20));
    const maintenanceScore = Math.max(0, 100 - (outdated.length * 10));
    const overallScore = Math.round((securityScore * 0.7 + maintenanceScore * 0.3));

    return {
      score: overallScore,
      vulnerabilities,
      outdated,
      security: {
        score: securityScore,
        vulnerabilities: vulnerabilities.length,
        practices: 8
      },
      maintenance: {
        score: maintenanceScore,
        outdated: outdated.length,
        frequency: 7
      }
    };
  }

  async getProjectHealth(projectId: string) {
    // Get the project's dependencies from the database
    const projectWithBranch = await this.projectRepository.getProjectWithBranch(projectId);
    if (!projectWithBranch?.monitoredBranch) {
      throw new Error('Project has no monitored branch');
    }

    const dependencies = await this.projectRepository.getBranchDependencies(projectWithBranch.monitoredBranch.id);
    
    if (dependencies.length === 0) {
      throw new Error('Project has no dependencies to analyze');
    }

    // Mock vulnerability data (in reality, you'd query your vulnerability database)
    const vulnerabilities = [
      {
        package: 'lodash',
        severity: 'high',
        description: 'Prototype pollution vulnerability'
      }
    ];

    // Mock outdated packages (in reality, you'd check against npm registry)
    const outdated = [
      {
        name: 'react',
        current: '17.0.0',
        latest: '18.2.0'
      }
    ];

    // Calculate health score
    const securityScore = Math.max(0, 100 - (vulnerabilities.length * 20));
    const maintenanceScore = Math.max(0, 100 - (outdated.length * 10));
    const overallScore = Math.round((securityScore * 0.7 + maintenanceScore * 0.3));

    return {
      score: overallScore,
      vulnerabilities,
      outdated,
      security: {
        score: securityScore,
        vulnerabilities: vulnerabilities.length,
        practices: 8
      },
      maintenance: {
        score: maintenanceScore,
        outdated: outdated.length,
        frequency: 7
      }
    };
  }

  async deleteProject(projectId: string) {
    // Get project info before deletion to check for webhook cleanup
    const project = await this.projectRepository.getProjectWithBranch(projectId);
    
    // Check if we should clean up the webhook BEFORE deleting the project
    if (project?.monitoredBranch?.repository_url) {
      // First, try to sync webhook IDs in case they're missing
      await this.webhookService.syncWebhookIdsForRepository(project.monitoredBranch.repository_url);
      
      const shouldDeleteWebhook = await this.webhookService.shouldDeleteWebhook(project.monitoredBranch.repository_url, projectId);
      if (shouldDeleteWebhook) {
        await this.webhookService.deleteWebhookForRepository(project.monitoredBranch.repository_url);
      }
    }
    
    // Delete the project AFTER webhook cleanup
    const result = await this.projectRepository.deleteProject(projectId);
    
    console.log(`✅ Project deleted: ${projectId}`);
    return result;
  }

  async syncAllWebhookIds() {
    console.log('🔄 Starting webhook ID sync for all projects...');
    
    // Get all unique repository URLs from monitored branches
    const monitoredBranches = await this.prisma.monitoredBranch.findMany({
      where: {
        repository_url: {
          not: null,
        },
      },
      select: {
        repository_url: true,
      },
      distinct: ['repository_url'],
    });

    const results = [];
    
    for (const branch of monitoredBranches) {
      if (branch.repository_url) {
        try {
          await this.webhookService.syncWebhookIdsForRepository(branch.repository_url);
          results.push({ repository: branch.repository_url, status: 'synced' });
        } catch (error) {
          results.push({ 
            repository: branch.repository_url, 
            status: 'error', 
            error: error.message 
          });
        }
      }
    }

    console.log(`✅ Webhook sync completed for ${results.length} repositories`);
    return {
      message: 'Webhook sync completed',
      results,
      total: results.length,
      successful: results.filter(r => r.status === 'synced').length,
      failed: results.filter(r => r.status === 'error').length,
    };
  }

  async debugAllProjects() {
    const allProjects = await this.prisma.project.findMany({
      include: {
        monitoredBranch: true,
        projectUsers: true,
      },
    });

    const allMonitoredBranches = await this.prisma.monitoredBranch.findMany();

    return {
      projects: allProjects,
      monitoredBranches: allMonitoredBranches,
      projectCount: allProjects.length,
      branchCount: allMonitoredBranches.length,
    };
  }

  async getWatchlistPackagesStatus(projectId: string) {
    try {
      const watchlistPackages = await this.prisma.projectWatchlistPackage.findMany({
        where: {
          project_id: projectId,
        },
        include: {
          package: true,
        },
      });

      // Return status information for each package
      return watchlistPackages.map(wp => ({
        id: wp.id,
        packageId: wp.package_id,
        packageName: wp.package.name,
        status: wp.package.status, // queued, fast, done
        hasScores: !!(wp.package.total_score !== null && wp.package.total_score !== undefined),
        addedAt: wp.added_at,
        addedBy: wp.added_by,
      }));
    } catch (error) {
      console.error('Error fetching watchlist packages status:', error);
      throw error;
    }
  }

  async refreshWatchlistPackages(projectId: string) {
    try {
      console.log('🔄 Refreshing watchlist packages for project:', projectId);
      
      const watchlistPackages = await this.prisma.projectWatchlistPackage.findMany({
        where: {
          project_id: projectId,
        },
        include: {
          package: true,
          addedByUser: {
            select: {
              name: true,
              email: true,
            }
          },
          approvedByUser: {
            select: {
              name: true,
              email: true,
            }
          },
          rejectedByUser: {
            select: {
              name: true,
              email: true,
            }
          },
          comments: {
            include: {
              user: {
                select: {
                  name: true,
                  email: true,
                }
              }
            }
          }
        },
      });

      console.log('📊 Found watchlist packages:', watchlistPackages.length);
      watchlistPackages.forEach(wp => {
        console.log(`Package ${wp.package.name}: status=${wp.package.status}, total_score=${wp.package.total_score}, hasScores=${wp.package.total_score !== null}`);
      });

      // Return full package data with all scores and metadata
      return watchlistPackages.map(wp => ({
        id: wp.id,
        name: wp.package.name,
        version: 'Unknown', // Version not stored in Packages model
        addedBy: wp.addedByUser?.name || wp.addedByUser?.email || wp.added_by,
        addedByUser: wp.addedByUser,
        addedAt: wp.added_at,
        added_at: wp.added_at,
        comments: wp.comments,
        riskScore: wp.package.total_score || 0,
        status: wp.status,
        approvedBy: wp.approvedByUser?.name || wp.approved_by,
        approvedByUser: wp.approvedByUser,
        rejectedBy: wp.rejectedByUser?.name || wp.rejected_by,
        rejectedByUser: wp.rejectedByUser,
        approvedAt: wp.approved_at,
        rejectedAt: wp.rejected_at,
        healthScore: wp.package.scorecard_score || 0,
        activityScore: wp.package.activity_score || 0,
        busFactor: wp.package.bus_factor_score || 0,
        license: wp.package.license || 'Unknown',
        vulnerabilities: wp.package.vulnerability_score || 0,
        pastVulnerabilities: 0, // This would need to be calculated separately
        package: {
          id: wp.package.id,
          name: wp.package.name,
          total_score: wp.package.total_score,
          vulnerability_score: wp.package.vulnerability_score,
          activity_score: wp.package.activity_score,
          bus_factor_score: wp.package.bus_factor_score,
          license_score: wp.package.license_score,
          scorecard_score: wp.package.scorecard_score,
          health_score: wp.package.scorecard_score,
          license: wp.package.license,
          repo_url: wp.package.repo_url,
          status: wp.package.status,
          stars: wp.package.stars,
          contributors: wp.package.contributors,
          summary: wp.package.summary,
        }
      }));
    } catch (error) {
      console.error('Error refreshing watchlist packages:', error);
      throw error;
    }
  }

  async getQueueStatus() {
    try {
      // Check if there are any pending jobs in the fast setup queue
      const fastSetupQueue = this.projectSetupQueue;
      const waiting = await fastSetupQueue.getWaiting();
      const active = await fastSetupQueue.getActive();
      const completed = await fastSetupQueue.getCompleted();
      const failed = await fastSetupQueue.getFailed();

      return {
        fastSetupQueue: {
          waiting: waiting.length,
          active: active.length,
          completed: completed.length,
          failed: failed.length,
          total: waiting.length + active.length + completed.length + failed.length
        },
        message: 'Queue status retrieved successfully'
      };
    } catch (error) {
      console.error('Error getting queue status:', error);
      return {
        error: error.message,
        message: 'Failed to get queue status'
      };
    }
  }
}
