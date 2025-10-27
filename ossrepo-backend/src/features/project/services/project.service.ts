import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { ProjectRepository } from '../repositories/project.repository';
import { CreateProjectDto } from '../dto/create-project.dto';
import { CreateProjectCliDto } from '../dto/create-project-cli.dto';
import { AnalyzeProjectDto } from '../dto/analyze-project.dto';
import { GitHubService } from 'src/common/github/github.service';
import { WebhookService } from 'src/common/webhook/webhook.service';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { UserService } from '../../user/user.service';

@Injectable()
export class ProjectService {
  constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly githubService: GitHubService,
    private readonly webhookService: WebhookService,
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    @InjectQueue('project-setup') private readonly projectSetupQueue: Queue,
  ) {}

  /**
   * Resolve a Clerk user id to the internal DB user id.
   * Throws 404 if no user is found for that Clerk id.
   */
  private async resolveDbUserIdOrThrow(clerkUserId: string): Promise<string> {
    const user = await this.userService.getUserByClerkId(clerkUserId);
    if (!user) {
      throw new NotFoundException('User not found for provided Clerk user id');
    }
    return user.user_id; // internal DB id
  }

  async createProject(createProjectDto: CreateProjectDto) {
    try {
      console.log('ProjectService: Creating project of type:', createProjectDto.type);

      // Create the project first
      const project = await this.projectRepository.createProject(createProjectDto);

      // Associate the creator (Clerk id -> DB id) as admin
      if (createProjectDto.userId) {
        const dbUserId = await this.resolveDbUserIdOrThrow(createProjectDto.userId);
        await this.projectRepository.createProjectUser(project.id, dbUserId, 'admin');
      }

      // Handle different project types
      if (createProjectDto.type === 'repo' && createProjectDto.repositoryUrl) {
        await this.projectSetupQueue.add('setup-project', {
          projectId: project.id,
          repositoryUrl: createProjectDto.repositoryUrl,
        });
      } else {
        await this.projectRepository.updateProjectStatus(project.id, 'ready');
      }

      return project;
    } catch (error) {
      console.error('Error creating project:', error);
      throw error;
    }
  }

  async getProjectsByUserId(userId: string) {
    // userId from controller is a Clerk id -> map to DB id
    const dbUserId = await this.resolveDbUserIdOrThrow(userId);
    return this.projectRepository.getProjectsByUserId(dbUserId);
  }

  private async setupRepositoryWebhook(repositoryUrl: string, projectId: string) {
    try {
      console.log(`Setting up webhook for repository: ${repositoryUrl}`);

      const match = repositoryUrl.match(/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?(?:\/.*)?$/);
      if (!match) throw new Error(`Invalid GitHub repository URL: ${repositoryUrl}`);

      const [, owner, repo] = match;
      console.log(`Creating webhook for: ${owner}/${repo}`);

      const octokit = await this.githubService.getAuthenticatedOctokit();

      const webhookUrl = `${process.env.BACKEND_URL || 'https://3bc645a139d6.ngrok-free.app'}/webhooks/github`;

      const webhook = await octokit.repos.createWebhook({
        owner,
        repo,
        config: {
          url: webhookUrl,
          content_type: 'json',
          secret: process.env.GITHUB_WEBHOOK_SECRET || 'your-webhook-secret',
        },
        events: ['push', 'pull_request', 'release', 'repository'],
        active: true,
      });

      console.log(`✅ Webhook created successfully for ${owner}/${repo}:`, webhook.data.id);
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
    const completedDependencies = dependencies.filter(
      (dep) => dep.package_id && dep.package && dep.package.status === 'done',
    );

    const progress =
      dependencies.length > 0 ? Math.round((completedDependencies.length / dependencies.length) * 100) : 0;

    return {
      progress,
      totalDependencies: dependencies.length,
      completedDependencies: completedDependencies.length,
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
    const project = await this.projectRepository.getProjectById(projectId);
    if (!project) throw new Error('Project not found');

    const projectWithBranch = await this.projectRepository.getProjectWithBranch(projectId);
    if (!projectWithBranch?.monitoredBranch?.repository_url) {
      throw new Error('Project has no repository URL');
    }

    try {
      const dependencies = await this.githubService.extractDependencies(projectWithBranch.monitoredBranch.repository_url);
      await this.projectRepository.clearBranchDependencies(projectWithBranch.monitoredBranch.id);
      await this.projectRepository.createBranchDependencies(projectWithBranch.monitoredBranch.id, dependencies);

      return {
        message: 'Dependencies refreshed successfully',
        dependencies,
      };
    } catch (error) {
      console.error('Error refreshing dependencies:', error);
      throw new Error(`Failed to refresh dependencies: ${error.message}`);
    }
  }

  async getUserRoleInProject(projectId: string, userId: string) {
    const dbUserId = await this.resolveDbUserIdOrThrow(userId);
    return this.projectRepository.getUserRoleInProject(projectId, dbUserId);
  }

  async joinProject(projectId: string, userId: string) {
    const project = await this.projectRepository.getProjectById(projectId);
    if (!project) throw new Error('Project not found');

    const dbUserId = await this.resolveDbUserIdOrThrow(userId);
    return this.projectRepository.addUserToProject(projectId, dbUserId, 'member');
  }

  async addToProjectWatchlist(projectId: string, userId: string, repoUrl: string, name: string) {
    const dbUserId = await this.resolveDbUserIdOrThrow(userId);
    return this.projectRepository.addToProjectWatchlist(projectId, dbUserId, repoUrl, name);
  }

  async getProjectWatchlist(projectId: string) {
    return this.projectRepository.getProjectWatchlist(projectId);
  }

  async getProjectWatchlistReview(projectWatchlistId: string) {
    return this.projectRepository.getProjectWatchlistReview(projectWatchlistId);
  }

  async updateWatchlistPackageStatus(watchlistId: string, status: string, userId?: string) {
    const dbUserId = userId ? await this.resolveDbUserIdOrThrow(userId) : undefined;
    return this.projectRepository.updateWatchlistPackageStatus(watchlistId, status, dbUserId);
  }

  async addWatchlistComment(watchlistId: string, userId: string, comment: string) {
    const dbUserId = await this.resolveDbUserIdOrThrow(userId);
    return this.projectRepository.addWatchlistComment(watchlistId, dbUserId, comment);
  }

  async updateProject(projectId: string, updateProjectDto: any) {
    return this.projectRepository.updateProject(projectId, updateProjectDto);
  }

  // CLI-specific methods
  async createProjectFromCli(createProjectCliDto: CreateProjectCliDto) {
    const repositoryUrl = createProjectCliDto.repositoryUrl || `cli://${createProjectCliDto.name}`;
    const branchName = createProjectCliDto.branch || 'main';

    const monitoredBranch = await this.prisma.monitoredBranch.create({
      data: {
        repository_url: repositoryUrl,
        branch_name: branchName,
        is_active: true,
      },
    });

    const project = await this.prisma.project.create({
      data: {
        name: createProjectCliDto.name,
        description: createProjectCliDto.description,
        type: 'cli',
        language: 'nodejs',
        license: createProjectCliDto.license,
        monitored_branch_id: monitoredBranch.id,
      },
    });

    // If a Clerk user id is provided from CLI, associate it; otherwise skip (no hard-coded user).
    if ((createProjectCliDto as any).userId) {
      const dbUserId = await this.resolveDbUserIdOrThrow((createProjectCliDto as any).userId);
      await this.projectRepository.createProjectUser(project.id, dbUserId, 'admin');
    }

    const dependencies = this.extractDependenciesFromPackageJson(createProjectCliDto.packageJson);
    if (dependencies.length > 0) {
      await this.projectRepository.createBranchDependencies(monitoredBranch.id, dependencies);
    }

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

    if (packageJson?.dependencies) {
      Object.entries(packageJson.dependencies).forEach(([name, version]) => {
        dependencies.push({ name, version: version as string });
      });
    }

    if (packageJson?.devDependencies) {
      Object.entries(packageJson.devDependencies).forEach(([name, version]) => {
        dependencies.push({ name, version: version as string });
      });
    }

    return dependencies;
  }

  async getProjectsForCli() {
    return this.projectRepository.getProjectsForCli();
  }

  async analyzeProjectHealth(projectId: string, analyzeProjectDto: AnalyzeProjectDto) {
    const projectWithBranch = await this.projectRepository.getProjectWithBranch(projectId);
    if (!projectWithBranch?.monitoredBranch) {
      throw new Error('Project has no monitored branch');
    }

    const dependencies = await this.projectRepository.getBranchDependencies(projectWithBranch.monitoredBranch.id);

    const packageJsonDeps = this.extractDependenciesFromPackageJson(analyzeProjectDto.packageJson);

    if (packageJsonDeps.length > 0) {
      await this.projectRepository.clearBranchDependencies(projectWithBranch.monitoredBranch.id);
      await this.projectRepository.createBranchDependencies(projectWithBranch.monitoredBranch.id, packageJsonDeps);
    }

    // --- mock scoring below unchanged ---
    const vulnerabilities = [{ package: 'lodash', severity: 'high', description: 'Prototype pollution vulnerability' }];
    const outdated = [{ name: 'react', current: '17.0.0', latest: '18.2.0' }];

    const securityScore = Math.max(0, 100 - vulnerabilities.length * 20);
    const maintenanceScore = Math.max(0, 100 - outdated.length * 10);
    const overallScore = Math.round(securityScore * 0.7 + maintenanceScore * 0.3);

    return {
      score: overallScore,
      vulnerabilities,
      outdated,
      security: { score: securityScore, vulnerabilities: vulnerabilities.length, practices: 8 },
      maintenance: { score: maintenanceScore, outdated: outdated.length, frequency: 7 },
    };
  }

  async getProjectHealth(projectId: string) {
    const projectWithBranch = await this.projectRepository.getProjectWithBranch(projectId);
    if (!projectWithBranch?.monitoredBranch) {
      throw new Error('Project has no monitored branch');
    }

    const dependencies = await this.projectRepository.getBranchDependencies(projectWithBranch.monitoredBranch.id);
    if (dependencies.length === 0) {
      throw new Error('Project has no dependencies to analyze');
    }

    // --- mock scoring below unchanged ---
    const vulnerabilities = [{ package: 'lodash', severity: 'high', description: 'Prototype pollution vulnerability' }];
    const outdated = [{ name: 'react', current: '17.0.0', latest: '18.2.0' }];

    const securityScore = Math.max(0, 100 - vulnerabilities.length * 20);
    const maintenanceScore = Math.max(0, 100 - outdated.length * 10);
    const overallScore = Math.round(securityScore * 0.7 + maintenanceScore * 0.3);

    return {
      score: overallScore,
      vulnerabilities,
      outdated,
      security: { score: securityScore, vulnerabilities: vulnerabilities.length, practices: 8 },
      maintenance: { score: maintenanceScore, outdated: outdated.length, frequency: 7 },
    };
  }

  async deleteProject(projectId: string) {
    const project = await this.projectRepository.getProjectWithBranch(projectId);

    if (project?.monitoredBranch?.repository_url) {
      await this.webhookService.syncWebhookIdsForRepository(project.monitoredBranch.repository_url);
      const shouldDeleteWebhook = await this.webhookService.shouldDeleteWebhook(
        project.monitoredBranch.repository_url,
        projectId,
      );
      if (shouldDeleteWebhook) {
        await this.webhookService.deleteWebhookForRepository(project.monitoredBranch.repository_url);
      }
    }

    const result = await this.projectRepository.deleteProject(projectId);
    console.log(`✅ Project deleted: ${projectId}`);
    return result;
  }

  async syncAllWebhookIds() {
    console.log('🔄 Starting webhook ID sync for all projects...');

    const monitoredBranches = await this.prisma.monitoredBranch.findMany({
      where: { repository_url: { not: null } },
      select: { repository_url: true },
      distinct: ['repository_url'],
    });

    const results = [];

    for (const branch of monitoredBranches) {
      if (branch.repository_url) {
        try {
          await this.webhookService.syncWebhookIdsForRepository(branch.repository_url);
          results.push({ repository: branch.repository_url, status: 'synced' });
        } catch (error) {
          results.push({ repository: branch.repository_url, status: 'error', error: (error as any).message });
        }
      }
    }

    console.log(`✅ Webhook sync completed for ${results.length} repositories`);
    return {
      message: 'Webhook sync completed',
      results,
      total: results.length,
      successful: results.filter((r) => r.status === 'synced').length,
      failed: results.filter((r) => r.status === 'error').length,
    };
  }

  async debugAllProjects() {
    const allProjects = await this.prisma.project.findMany({
      include: { monitoredBranch: true, projectUsers: true },
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
        where: { project_id: projectId },
        include: { package: true },
      });

      return watchlistPackages.map((wp) => ({
        id: wp.id,
        packageId: wp.package_id,
        packageName: wp.package.name,
        status: wp.package.status,
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
        where: { project_id: projectId },
        include: {
          package: true,
          addedByUser: { select: { name: true, email: true } },
          approvedByUser: { select: { name: true, email: true } },
          rejectedByUser: { select: { name: true, email: true } },
          comments: {
            include: { user: { select: { name: true, email: true } } },
          },
        },
      });

      console.log('📊 Found watchlist packages:', watchlistPackages.length);
      watchlistPackages.forEach((wp) => {
        console.log(
          `Package ${wp.package.name}: status=${wp.package.status}, total_score=${wp.package.total_score}, hasScores=${wp.package.total_score !== null}`,
        );
      });

      return watchlistPackages.map((wp) => ({
        id: wp.id,
        name: wp.package.name,
        version: 'Unknown',
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
        pastVulnerabilities: 0,
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
        },
      }));
    } catch (error) {
      console.error('Error refreshing watchlist packages:', error);
      throw error;
    }
  }

  async getQueueStatus() {
    try {
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
          total: waiting.length + active.length + completed.length + failed.length,
        },
        message: 'Queue status retrieved successfully',
      };
    } catch (error) {
      console.error('Error getting queue status:', error);
      return { error: (error as any).message, message: 'Failed to get queue status' };
    }
  }
}
