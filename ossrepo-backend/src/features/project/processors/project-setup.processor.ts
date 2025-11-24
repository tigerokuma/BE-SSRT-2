import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { GitHubService } from '../../../common/github/github.service';
import { GitHubAppService } from '../../../common/github/github-app.service';
import { WebhookService } from '../../../common/webhook/webhook.service';
import { ProjectRepository } from '../repositories/project.repository';
import { DependencyQueueService } from '../../dependencies/services/dependency-queue.service';
import { GraphService } from 'src/features/graph/services/graph.service';

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
    private readonly graphService: GraphService,
  ) {
    this.logger.log('🔧 ProjectSetupProcessor initialized and ready to process jobs');
  }

  @Process('setup-project')
  async handleProjectSetup(job: Job<ProjectSetupJobData>) {
    const { projectId, repositoryUrl } = job.data;
    const startTime = Date.now();

    this.logger.log(`🚀 [ProjectSetupProcessor] Starting project setup for ${projectId}`);

    try {
      // 1) Mark as creating
      await this.projectRepository.updateProjectStatus(projectId, 'creating');

      // 2) Load project + branch
      const projectWithBranch = await this.projectRepository.getProjectWithBranch(projectId);
      this.logger.log(
        `[ProjectSetupProcessor] Loaded projectWithBranch: ` +
          JSON.stringify(projectWithBranch, null, 2),
      );

      if (!projectWithBranch?.monitoredBranch) {
        throw new Error('Project has no monitored branch');
      }

      const branchId = projectWithBranch.monitoredBranch.id;
      const branchName =
        (projectWithBranch.monitoredBranch as any).branch_name ?? 'main';

      // 3) Resolve admin user (for GitHub token)
      const projectUsers = await this.prisma.projectUser.findMany({
        where: { project_id: projectId, role: 'admin' },
        select: { user_id: true },
      });

      const userId = projectUsers.length > 0 ? projectUsers[0].user_id : undefined;
      this.logger.log(
        `[ProjectSetupProcessor] Using admin userId=${userId ?? 'none'} for GitHub token`,
      );

      let createdDependencies: Array<{ id: string; name: string }> = [];

      // --- A) Dependencies: wrap in its own try/catch so errors don't kill graph build ---
      try {
        this.logger.log(
          `[ProjectSetupProcessor] Extracting dependencies from ${repositoryUrl}`,
        );
        const deps = await this.githubService.extractDependencies(repositoryUrl, userId);

        await this.projectRepository.clearBranchDependencies(branchId);
        createdDependencies =
          await this.projectRepository.createBranchDependenciesWithReturn(
            branchId,
            deps,
          );

        this.logger.log(
          `📦 [ProjectSetupProcessor] Extracted ${deps.length} deps, created ${createdDependencies.length} branch deps`,
        );

        if (createdDependencies.length === 0) {
          // Fast path: no deps, mark ready with perfect health
          this.logger.log(
            `📭 No dependencies found - marking project as ready immediately with health score 100`,
          );
          await this.prisma.project.update({
            where: { id: projectId },
            data: {
              status: 'ready',
              health_score: 100,
            },
          });
        } else {
          // Queue fast-setup jobs
          for (const branchDependency of createdDependencies) {
            let repoUrl: string | undefined;
            try {
              repoUrl = await this.findRepositoryUrl(branchDependency.name);
              if (repoUrl) {
                this.logger.log(
                  `🔍 Found repository URL for ${branchDependency.name}: ${repoUrl}`,
                );
              } else {
                this.logger.log(
                  `⚠️ No repository URL found for ${branchDependency.name}`,
                );
              }
            } catch (err: any) {
              this.logger.warn(
                `⚠️ Error finding repository URL for ${branchDependency.name}: ${
                  err?.message ?? err
                }`,
              );
            }

            await this.dependencyQueueService.queueFastSetup({
              branchDependencyId: branchDependency.id,
              branchId,
              projectId,
              packageName: branchDependency.name,
              repoUrl,
            });

            this.logger.log(
              `📋 Queued fast-setup job for dependency: ${branchDependency.name}`,
            );
          }

          this.logger.log(
            `⏳ Project setup initiated, waiting for ${createdDependencies.length} dependencies to be analyzed`,
          );
        }
      } catch (depError: any) {
        this.logger.error(
          `[ProjectSetupProcessor] Dependency extraction failed but continuing: ${
            depError?.message ?? depError
          }`,
        );
      }

      // --- B) Webhook: best-effort ---
      try {
        this.logger.log(
          `[ProjectSetupProcessor] Setting up webhook for ${repositoryUrl}`,
        );
        await this.webhookService.setupWebhookForRepository(
          repositoryUrl,
          branchId,
          userId,
        );
        this.logger.log(`🔗 [ProjectSetupProcessor] Webhook set up successfully`);
      } catch (whError: any) {
        this.logger.error(
          `[ProjectSetupProcessor] Webhook setup failed but continuing: ${
            whError?.message ?? whError
          }`,
        );
      }

      // --- C) GitHub App installation linking (best-effort) ---
      try {
        const installationId =
          await this.githubAppService.findInstallationForRepository(repositoryUrl);
        if (installationId) {
          await this.prisma.project.update({
            where: { id: projectId },
            data: {
              github_app_installation_id: installationId,
              github_actions_enabled: true,
            },
          });
          this.logger.log(
            `✅ Linked GitHub App installation ${installationId} to project ${projectId}`,
          );
        } else {
          this.logger.log(
            `ℹ️ No GitHub App installation found for repository ${repositoryUrl}`,
          );
        }
      } catch (error: any) {
        this.logger.warn(
          `⚠️ Could not check for GitHub App installation: ${error?.message ?? error}`,
        );
        // Do not fail setup on this
      }

      // --- D) GRAPH BUILD: main thing we care about right now ---
      const repoSlug = this.extractGitHubSlug(repositoryUrl);
      this.logger.log(
        `🧠 [ProjectSetupProcessor] Queuing initial graph build for ${repoSlug}#${branchName}`,
      );

      try {
        await this.graphService.triggerBuild(repoSlug, {
          branch: branchName,
          startSha: null,
        });
        this.logger.log(
          `✅ [ProjectSetupProcessor] Graph build triggered for ${repoSlug}#${branchName}`,
        );
      } catch (graphError: any) {
        this.logger.error(
          `❌ [ProjectSetupProcessor] Failed to trigger graph build: ${
            graphError?.message ?? graphError
          }`,
        );
        // we *could* mark project failed here if you want
      }

      // 4) Mark project as ready (or leave as ready if already set above)
      await this.projectRepository.updateProjectStatus(projectId, 'ready');
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.log(
        `✅ [ProjectSetupProcessor] Project setup complete for ${projectId} in ${duration}s`,
      );

      return {
        success: true,
        projectId,
        dependenciesCount: createdDependencies.length,
        duration: `${duration}s`,
      };
    } catch (error: any) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `❌ Project setup failed for project ${projectId}: ${msg}`,
        error instanceof Error ? error.stack : undefined,
      );
      await this.projectRepository.updateProjectStatus(projectId, 'failed', msg);
      throw error;
    }
  }

  private extractGitHubSlug(repositoryUrl: string): string {
    // https://github.com/owner/repo(.git) -> owner/repo
    return repositoryUrl
      .replace(/^https?:\/\/github\.com\//, '')
      .replace(/\.git$/, '');
  }

  private async findRepositoryUrl(
    packageName: string,
  ): Promise<string | undefined> {
    try {
      // Query npm registry API to get package info
      const npmUrl = `https://registry.npmjs.org/${packageName}`;
      const response = await fetch(npmUrl);

      if (!response.ok) {
        this.logger.log(
          `⚠️ NPM API returned ${response.status} for ${packageName}`,
        );
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
          this.logger.log(
            `✅ Found GitHub repository for ${packageName}: ${repoUrl}`,
          );
          return repoUrl;
        } else {
          this.logger.log(
            `⚠️ Repository for ${packageName} is not on GitHub: ${repoUrl}`,
          );
          return undefined;
        }
      } else {
        this.logger.log(
          `⚠️ No repository URL found in package data for ${packageName}`,
        );
        return undefined;
      }
    } catch (error: any) {
      this.logger.log(
        `❌ Error fetching repository URL for ${packageName}: ${
          error?.message ?? error
        }`,
      );
      return undefined;
    }
  }
}
