import { Controller, Post, Headers, Body, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PackageChangeDetectorService } from './services/package-change-detector.service';
import { DependencyTrackerService } from './services/dependency-tracker.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly packageChangeDetector: PackageChangeDetectorService,
    private readonly dependencyTracker: DependencyTrackerService
  ) {}

  @Post('github')
  @ApiOperation({ summary: 'Handle GitHub webhook events' })
  @ApiResponse({ status: 200, description: 'Webhook processed successfully' })
  async handleGitHubWebhook(
    @Headers() headers: any,
    @Body() payload: any,
  ) {
    try {
      const event = headers['x-github-event'];
      const delivery = headers['x-github-delivery'];
      
      this.logger.log(`Received GitHub webhook: ${event} (${delivery})`);
      
      // Handle different webhook events
      switch (event) {
        case 'push':
          await this.handlePushEvent(payload);
          break;
        case 'pull_request':
          await this.handlePullRequestEvent(payload);
          break;
        case 'release':
          await this.handleReleaseEvent(payload);
          break;
        case 'repository':
          await this.handleRepositoryEvent(payload);
          break;
        default:
          this.logger.log(`Unhandled webhook event: ${event}`);
      }
      
      return { status: 'success', message: 'Webhook processed' };
    } catch (error) {
      this.logger.error('Error processing webhook:', error);
      throw error;
    }
  }

  private async handlePushEvent(payload: any) {
    const { repository, commits, ref, pusher } = payload;
    
    // Extract branch name from ref (refs/heads/main -> main)
    const branchName = ref.replace('refs/heads/', '');
    
    // Look up projects that monitor this repository and branch
    const projects = await this.prisma.project.findMany({
      where: {
        monitoredBranch: {
          repository_url: repository.html_url,
          branch_name: branchName,
          is_active: true
        }
      },
      select: {
        id: true,
        name: true,
        monitoredBranch: {
          select: {
            id: true,
            branch_name: true,
            repository_url: true,
          }
        }
      }
    });
    
    if (projects.length === 0) {
      return; // Silently ignore
    }
    
    this.logger.log(`🚀 Commits pushed to ${repository.full_name}/${branchName} (${commits.length} commits)`);
    
    // Check for package.json changes in commits
    await this.analyzeCommitsForPackageJsonChanges(repository, commits, projects);
  }

  private async analyzeCommitsForPackageJsonChanges(repository: any, commits: any[], projects: any[]) {
    try {
      const [owner, repo] = repository.full_name.split('/');
      const commitShas = commits.map(commit => commit.id);
      
      const analysis = await this.packageChangeDetector.checkCommitsForPackageJsonChanges(
        owner,
        repo,
        commitShas
      );
      
      if (analysis.commitsWithPackageJsonChanges > 0) {
        // Trigger dependency analysis for the latest commit
        await this.analyzeDependenciesForCommits(repository, commits, projects);
      }
    } catch (error) {
      this.logger.error(`❌ Error analyzing commits for package.json changes:`, error.message);
    }
  }

  private async analyzePullRequestForPackageJsonChanges(repository: any, pullRequest: any, projects: any[]) {
    try {
      const [owner, repo] = repository.full_name.split('/');
      
      const analysis = await this.packageChangeDetector.checkPullRequestForPackageJsonChanges(
        owner,
        repo,
        pullRequest.number
      );
      
      if (analysis.hasPackageJsonChanges) {
        // Trigger dependency analysis for the merged PR
        await this.analyzeDependenciesForMergedPR(repository, pullRequest, projects);
      }
    } catch (error) {
      this.logger.error(`❌ Error analyzing PR #${pullRequest.number} for package.json changes:`, error.message);
    }
  }

  private async analyzeDependenciesForCommits(repository: any, commits: any[], projects: any[]) {
    try {
      const [owner, repo] = repository.full_name.split('/');
      const latestCommit = commits[0]; // Use the latest commit
      
      for (const project of projects) {
        await this.dependencyTracker.analyzeAndUpdateDependencies(
          owner,
          repo,
          latestCommit.id,
          project.monitoredBranch.id
        );
      }
    } catch (error) {
      this.logger.error(`❌ Error analyzing dependencies for commits:`, error.message);
    }
  }

  private async analyzeDependenciesForMergedPR(repository: any, pullRequest: any, projects: any[]) {
    try {
      const [owner, repo] = repository.full_name.split('/');
      
      for (const project of projects) {
        await this.dependencyTracker.analyzeAndUpdateDependencies(
          owner,
          repo,
          pullRequest.merge_commit_sha || pullRequest.head.sha,
          project.monitoredBranch.id
        );
      }
    } catch (error) {
      this.logger.error(`❌ Error analyzing dependencies for merged PR:`, error.message);
    }
  }

  private async handlePullRequestEvent(payload: any) {
    const { action, pull_request, repository } = payload;
    
    const targetBranch = pull_request.base.ref;
    
    // Look up projects that monitor this repository and target branch
    const projects = await this.prisma.project.findMany({
      where: {
        monitoredBranch: {
          repository_url: repository.html_url,
          branch_name: targetBranch,
          is_active: true
        }
      },
      select: {
        id: true,
        name: true,
        monitoredBranch: {
          select: {
            id: true,
            branch_name: true,
            repository_url: true,
          }
        }
      }
    });
    
    if (projects.length === 0) {
      return; // Silently ignore
    }
    
    if (action === 'closed' && pull_request.merged) {
      this.logger.log(`🔀 PR #${pull_request.number} merged to ${targetBranch}: ${pull_request.title}`);
      // Check for package.json changes only when PR is merged
      await this.analyzePullRequestForPackageJsonChanges(repository, pull_request, projects);
    }
    // Silently ignore other PR actions (opened, synchronize, etc.)
  }

  private async handleReleaseEvent(payload: any) {
    const { action, release, repository } = payload;
    this.logger.log(`🏷️ Release ${action} for ${repository.full_name}: ${release.tag_name}`);
    this.logger.log(`📝 Description: ${release.body || 'No description'}`);
    this.logger.log(`👤 Author: ${release.author.login}`);
    
    if (action === 'published') {
      this.logger.log(`🔍 Would analyze release for security vulnerabilities...`);
    }
  }

  private async handleRepositoryEvent(payload: any) {
    const { action, repository } = payload;
    this.logger.log(`📁 Repository ${action}: ${repository.full_name}`);
    this.logger.log(`🔒 Private: ${repository.private}`);
    this.logger.log(`⭐ Stars: ${repository.stargazers_count}`);
    
    if (action === 'created') {
      this.logger.log(`🎉 New repository created!`);
    } else if (action === 'deleted') {
      this.logger.log(`🗑️ Repository deleted!`);
    }
  }
}
