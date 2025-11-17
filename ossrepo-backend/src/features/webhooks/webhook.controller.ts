import { Controller, Post, Headers, Body, Logger, RawBodyRequest, Req } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PackageChangeDetectorService } from './services/package-change-detector.service';
import { DependencyTrackerService } from './services/dependency-tracker.service';
import { GitHubAppService } from '../../common/github/github-app.service';
import { PRPackageCheckService } from '../project/services/pr-package-check.service';
import { DependencyQueueService } from '../dependencies/services/dependency-queue.service';
import { extractPackagesFromPRFiles } from '../project/utils/package-extractor.util';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly packageChangeDetector: PackageChangeDetectorService,
    private readonly dependencyTracker: DependencyTrackerService,
    private readonly githubAppService: GitHubAppService,
    private readonly prPackageCheckService: PRPackageCheckService,
    private readonly dependencyQueueService: DependencyQueueService,
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
      
      this.logger.log(`🔔 Received GitHub webhook: ${event} (${delivery})`);
      this.logger.log(`📦 Payload keys: ${Object.keys(payload).join(', ')}`);
      
      // Log installation info if present
      if (payload.installation) {
        this.logger.log(`🔧 Installation ID: ${payload.installation.id}, Repositories: ${payload.installation.repositories?.length || 0}`);
      }
      
      // For PR events, log if it's from GitHub App
      if (event === 'pull_request' && payload.installation) {
        this.logger.log(`✅ This is a GitHub App PR webhook (installation: ${payload.installation.id})`);
      } else if (event === 'pull_request') {
        this.logger.log(`⚠️ This is a regular PR webhook (no installation field)`);
      }
      
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
        case 'installation':
          // GitHub App installation events
          await this.handleGitHubAppInstallation(payload);
          break;
        case 'installation_repositories':
          // GitHub App repository addition/removal
          await this.handleGitHubAppInstallationRepositories(payload);
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
    const { action, pull_request, repository, installation } = payload;
    
    // Check if this is a GitHub App webhook (has installation field)
    if (installation) {
      // Handle as GitHub App webhook for package approval checks
      await this.handleGitHubAppPullRequest(payload);
      return;
    }
    
    // For regular webhooks, check if project has GitHub App installed
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
        github_app_installation_id: true,
        github_actions_enabled: true,
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
    
    // Check if any project has GitHub App installed - if so, handle as GitHub App PR
    const projectWithApp = projects.find(p => p.github_app_installation_id && p.github_actions_enabled);
    if (projectWithApp && ['opened', 'synchronize', 'reopened'].includes(action)) {
      this.logger.log(`🔧 Regular webhook but project has GitHub App - handling as GitHub App PR`);
      // Create a payload with installation info
      const appPayload = {
        ...payload,
        installation: {
          id: parseInt(projectWithApp.github_app_installation_id),
        }
      };
      await this.handleGitHubAppPullRequest(appPayload);
      return;
    }
    
    // Otherwise handle as regular webhook (for merged PRs)
    if (action === 'closed' && pull_request.merged) {
      this.logger.log(`🔀 PR #${pull_request.number} merged to ${targetBranch}: ${pull_request.title}`);
      // Check for package.json changes only when PR is merged
      await this.analyzePullRequestForPackageJsonChanges(repository, pull_request, projects);
    }
    // Silently ignore other PR actions
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


  private async handleGitHubAppPullRequest(payload: any) {
    const { action, pull_request, installation, repository } = payload;

    // Only handle opened, synchronize, and reopened actions
    if (!['opened', 'synchronize', 'reopened'].includes(action)) {
      return;
    }

    const installationId = installation?.id?.toString();
    if (!installationId) {
      this.logger.warn('No installation ID in PR webhook payload');
      return;
    }

    const [owner, repo] = repository.full_name.split('/');
    const prNumber = pull_request.number;
    const repositoryUrl = repository.html_url;

    this.logger.log(`📦 Processing PR #${prNumber} in ${owner}/${repo}`);

    try {
      // Get PR files to extract package changes
      const files = await this.githubAppService.getPRFiles(
        installationId,
        owner,
        repo,
        prNumber,
      );

      this.logger.log(`📁 Found ${files.length} changed files in PR #${prNumber}`);
      for (const file of files) {
        this.logger.log(`  - ${file.filename} (status: ${file.status}, patch: ${file.patch ? 'yes' : 'no'})`);
        if (file.filename === 'package.json' && file.patch) {
          this.logger.log(`  📄 package.json patch preview (first 500 chars):\n${file.patch.substring(0, 500)}`);
        }
      }

      // Extract package names from changed files
      const packageChanges = extractPackagesFromPRFiles(files);
      const addedPackages = packageChanges
        .filter((pkg) => pkg.type === 'added')
        .map((pkg) => pkg.name);

      if (addedPackages.length === 0) {
        this.logger.log(`No package additions detected in PR #${prNumber}`);
        return;
      }

      this.logger.log(`Found ${addedPackages.length} added packages: ${addedPackages.join(', ')}`);

      // Find project by repository URL
      const project = await this.prisma.project.findFirst({
        where: {
          monitoredBranch: {
            repository_url: repositoryUrl,
          },
          github_actions_enabled: true,
          github_app_installation_id: installationId,
        },
        include: {
          monitoredBranch: true,
        },
      });

      if (!project) {
        this.logger.log(`No project found for repository ${repositoryUrl} with installation ${installationId}`);
        return;
      }

      // Check if packages are approved
      let checkResult = await this.prPackageCheckService.checkPRPackages(
        project.id,
        repositoryUrl,
        addedPackages,
      );

      // Queue fast-setup for unapproved packages that don't have health scores yet
      const packagesNeedingSetup: string[] = [];
      for (const unapprovedPkg of checkResult.unapproved) {
        const packageDetails = checkResult.packageDetails[unapprovedPkg];
        // Only queue if package doesn't exist in our database or doesn't have a health score
        if (!packageDetails || !packageDetails.id || !packageDetails.healthScore) {
          packagesNeedingSetup.push(unapprovedPkg);
          try {
            // Try to find repository URL from npm
            let repoUrl: string | undefined;
            try {
              const npmUrl = `https://registry.npmjs.org/${unapprovedPkg}`;
              const response = await fetch(npmUrl);
              if (response.ok) {
                const data = await response.json();
                if (data.repository?.url) {
                  let repoUrlRaw = data.repository.url;
                  // Clean up the URL
                  if (repoUrlRaw.startsWith('git+https://')) {
                    repoUrlRaw = repoUrlRaw.replace('git+https://', 'https://');
                  }
                  if (repoUrlRaw.startsWith('git+ssh://')) {
                    repoUrlRaw = repoUrlRaw.replace('git+ssh://git@', 'https://');
                  }
                  if (repoUrlRaw.endsWith('.git')) {
                    repoUrlRaw = repoUrlRaw.replace('.git', '');
                  }
                  if (repoUrlRaw.includes('github.com')) {
                    repoUrl = repoUrlRaw;
                  }
                }
              }
            } catch (error) {
              this.logger.warn(`Could not fetch repo URL for ${unapprovedPkg}: ${error.message}`);
            }

            // Get or create package record
            let packageRecord = await this.prisma.packages.findUnique({
              where: { name: unapprovedPkg },
            });

            if (!packageRecord) {
              packageRecord = await this.prisma.packages.create({
                data: {
                  name: unapprovedPkg,
                  repo_url: repoUrl,
                  status: 'queued',
                },
              });
            }

            // Queue fast-setup job
            await this.dependencyQueueService.queueFastSetup({
              packageId: packageRecord.id,
              packageName: unapprovedPkg,
              repoUrl: repoUrl,
              projectId: project.id,
            });

            this.logger.log(`📋 Queued fast-setup for unapproved package: ${unapprovedPkg}`);
          } catch (error) {
            this.logger.error(`Failed to queue fast-setup for ${unapprovedPkg}:`, error);
          }
        }
      }

      // Wait for fast-setup to complete (with timeout)
      if (packagesNeedingSetup.length > 0) {
        this.logger.log(`⏳ Waiting for health scores to be calculated for ${packagesNeedingSetup.length} package(s)...`);
        const maxWaitTime = 30000; // 30 seconds
        const pollInterval = 2000; // 2 seconds
        const startTime = Date.now();
        
        while (Date.now() - startTime < maxWaitTime) {
          // Re-check packages to get updated health scores
          checkResult = await this.prPackageCheckService.checkPRPackages(
            project.id,
            repositoryUrl,
            addedPackages,
          );

          // Check if all packages now have health scores
          const allHaveScores = packagesNeedingSetup.every(pkgName => {
            const details = checkResult.packageDetails[pkgName];
            return details && details.healthScore !== null && details.healthScore !== undefined;
          });

          if (allHaveScores) {
            this.logger.log(`✅ All health scores calculated`);
            break;
          }

          // Wait before polling again
          await new Promise(resolve => setTimeout(resolve, pollInterval));
        }

        if (Date.now() - startTime >= maxWaitTime) {
          this.logger.warn(`⏰ Timeout waiting for health scores, posting comment with available data`);
        }
      }

      // Generate comment with final data
      const comment = this.generatePRComment(checkResult, addedPackages, project.license);

      // Post comment on PR
      await this.githubAppService.postPRComment(
        installationId,
        owner,
        repo,
        prNumber,
        comment,
      );

      this.logger.log(`Posted comment on PR #${prNumber}`);
    } catch (error) {
      this.logger.error(`Error handling PR webhook:`, error);
    }
  }

  private async handleGitHubAppInstallation(payload: any) {
    const { action, installation } = payload;

    this.logger.log(`🔧 Installation webhook: action=${action}, installationId=${installation?.id}`);

    if (action === 'created') {
      const installationId = installation.id.toString();
      const repositories = installation.repositories || [];

      this.logger.log(`✅ GitHub App installed with ID ${installationId} on ${repositories.length} repositories`);

      // Link installation to projects
      for (const repo of repositories) {
        const repositoryUrl = repo.html_url;
        this.logger.log(`🔍 Looking for project with repository: ${repositoryUrl}`);
        
        const result = await this.prisma.project.updateMany({
          where: {
            monitoredBranch: {
              repository_url: repositoryUrl,
            },
          },
          data: {
            github_app_installation_id: installationId,
            github_actions_enabled: true,
          },
        });
        
        this.logger.log(`📝 Updated ${result.count} project(s) for repository ${repositoryUrl} with installation ${installationId}`);
      }
    } else if (action === 'deleted') {
      const installationId = installation.id.toString();

      this.logger.log(`GitHub App uninstalled with ID ${installationId}`);

      // Clear installation ID from projects
      await this.prisma.project.updateMany({
        where: {
          github_app_installation_id: installationId,
        },
        data: {
          github_app_installation_id: null,
          github_actions_enabled: false,
        },
      });
    }
  }

  private async handleGitHubAppInstallationRepositories(payload: any) {
    const { action, installation, repositories_added, repositories_removed } = payload;
    const installationId = installation.id.toString();

    if (action === 'added') {
      for (const repo of repositories_added || []) {
        const repositoryUrl = repo.html_url;
        await this.prisma.project.updateMany({
          where: {
            monitoredBranch: {
              repository_url: repositoryUrl,
            },
          },
          data: {
            github_app_installation_id: installationId,
            github_actions_enabled: true,
          },
        });
        this.logger.log(`Linked installation ${installationId} to repository ${repositoryUrl}`);
      }
    } else if (action === 'removed') {
      for (const repo of repositories_removed || []) {
        const repositoryUrl = repo.html_url;
        await this.prisma.project.updateMany({
          where: {
            monitoredBranch: {
              repository_url: repositoryUrl,
            },
            github_app_installation_id: installationId,
          },
          data: {
            github_app_installation_id: null,
            github_actions_enabled: false,
          },
        });
        this.logger.log(`Unlinked installation ${installationId} from repository ${repositoryUrl}`);
      }
    }
  }

  private checkLicenseCompatibility(
    projectLicense: string | null | undefined,
    packageLicense: string | null | undefined,
  ): { isCompatible: boolean; reason: string } {
    // Handle undefined/null cases
    if (!projectLicense || projectLicense === 'unlicensed' || projectLicense === 'none') {
      return {
        isCompatible: true,
        reason: 'Project has no license restrictions',
      };
    }

    if (!packageLicense || packageLicense === 'unlicensed' || packageLicense === 'none') {
      return {
        isCompatible: false,
        reason: 'Package has no license',
      };
    }

    const projectLower = projectLicense.toLowerCase();
    const packageLower = packageLicense.toLowerCase();

    // Same license - always compatible
    if (projectLower === packageLower) {
      return {
        isCompatible: true,
        reason: 'Same license',
      };
    }

    // MIT license - compatible with most licenses
    if (projectLower.includes('mit')) {
      if (packageLower.includes('mit') || packageLower.includes('apache') || 
          packageLower.includes('bsd') || packageLower.includes('isc') ||
          packageLower.includes('unlicense') || packageLower.includes('cc0')) {
        return {
          isCompatible: true,
          reason: 'Compatible',
        };
      }
      
      if (packageLower.includes('gpl')) {
        return {
          isCompatible: false,
          reason: 'GPL incompatible with MIT',
        };
      }
    }

    // Apache license - compatible with most permissive licenses
    if (projectLower.includes('apache')) {
      if (packageLower.includes('mit') || packageLower.includes('apache') || 
          packageLower.includes('bsd') || packageLower.includes('isc') ||
          packageLower.includes('unlicense') || packageLower.includes('cc0')) {
        return {
          isCompatible: true,
          reason: 'Compatible',
        };
      }
      
      if (packageLower.includes('gpl')) {
        return {
          isCompatible: false,
          reason: 'GPL incompatible with Apache',
        };
      }
    }

    // BSD licenses - compatible with most permissive licenses
    if (projectLower.includes('bsd')) {
      if (packageLower.includes('mit') || packageLower.includes('apache') || 
          packageLower.includes('bsd') || packageLower.includes('isc') ||
          packageLower.includes('unlicense') || packageLower.includes('cc0')) {
        return {
          isCompatible: true,
          reason: 'Compatible',
        };
      }
      
      if (packageLower.includes('gpl')) {
        return {
          isCompatible: false,
          reason: 'GPL incompatible with BSD',
        };
      }
    }

    // GPL projects - can use GPL and compatible licenses
    if (projectLower.includes('gpl')) {
      if (packageLower.includes('gpl') || packageLower.includes('mit') || 
          packageLower.includes('apache') || packageLower.includes('bsd') ||
          packageLower.includes('isc') || packageLower.includes('unlicense') ||
          packageLower.includes('cc0')) {
        return {
          isCompatible: true,
          reason: 'Compatible',
        };
      }
    }

    // AGPL projects - most restrictive
    if (projectLower.includes('agpl')) {
      if (packageLower.includes('agpl') || packageLower.includes('gpl') ||
          packageLower.includes('mit') || packageLower.includes('apache') || 
          packageLower.includes('bsd') || packageLower.includes('isc') ||
          packageLower.includes('unlicense') || packageLower.includes('cc0')) {
        return {
          isCompatible: true,
          reason: 'Compatible',
        };
      }
    }

    // Unknown license combinations
    return {
      isCompatible: false,
      reason: 'Review required',
    };
  }

  private generatePRComment(
    checkResult: {
      approved: Array<{ name: string; version?: string; details: any }>;
      unapproved: string[];
      packageDetails: Record<string, any>;
    },
    allPackages: string[],
    projectLicense: string | null | undefined,
  ): string {
    if (checkResult.approved.length === 0 && checkResult.unapproved.length === 0) {
      return '';
    }

    let comment = '## Package Changes Detected\n\n';

    // Show approved packages first
    if (checkResult.approved.length > 0) {
      comment += '### ✅ Approved Packages\n\n';
      comment += '| Package | Health Score | Vulnerabilities | License Compatibility |\n';
      comment += '|---------|-------------|-----------------|----------------------|\n';
      
      for (const approvedPkg of checkResult.approved) {
        const packageDetails = approvedPkg.details || {};
        const healthScore = packageDetails.healthScore;
        const hasVulnerabilities = packageDetails.hasVulnerabilities || false;
        const vulnerabilityCount = packageDetails.vulnerabilityCount || 0;
        const packageLicense = packageDetails.license || 'Unknown';

        // Format health score
        let healthScoreText = 'N/A';
        if (healthScore !== null && healthScore !== undefined) {
          const score = healthScore.toFixed(1);
          if (healthScore >= 80) {
            healthScoreText = `🟢 ${score}/100`;
          } else if (healthScore >= 60) {
            healthScoreText = `🟡 ${score}/100`;
          } else {
            healthScoreText = `🔴 ${score}/100`;
          }
        }

        // Format vulnerabilities
        let vulnerabilityText = 'None';
        if (hasVulnerabilities || vulnerabilityCount > 0) {
          const count = vulnerabilityCount > 0 ? vulnerabilityCount : 'Yes';
          vulnerabilityText = `⚠️ ${count}`;
        }

        // Check license compatibility
        const licenseCompatibility = this.checkLicenseCompatibility(projectLicense, packageLicense);
        const licenseText = packageLicense || 'Unknown';
        const compatibilityIcon = licenseCompatibility.isCompatible ? '✅' : '❌';
        const licenseCompatibilityText = `${licenseText} ${compatibilityIcon}`;

        comment += `| \`${approvedPkg.name}\` | ${healthScoreText} | ${vulnerabilityText} | ${licenseCompatibilityText} |\n`;
      }
      comment += '\n';
    }

    // Show unapproved packages with warning
    if (checkResult.unapproved.length > 0) {
      comment += '### ⚠️ Unapproved Packages\n\n';
      comment += 'These packages are **not approved** on your project watchlist.\n\n';
      comment += '| Package | Health Score | Vulnerabilities | License Compatibility | Status |\n';
      comment += '|---------|-------------|-----------------|----------------------|--------|\n';
      
      for (const pkgName of checkResult.unapproved) {
        const packageDetails = checkResult.packageDetails[pkgName] || {};
        const healthScore = packageDetails.healthScore;
        const hasVulnerabilities = packageDetails.hasVulnerabilities || false;
        const vulnerabilityCount = packageDetails.vulnerabilityCount || 0;
        const packageLicense = packageDetails.license || 'Unknown';

        // Format health score
        let healthScoreText = 'N/A';
        if (healthScore !== null && healthScore !== undefined) {
          const score = healthScore.toFixed(1);
          if (healthScore >= 80) {
            healthScoreText = `🟢 ${score}/100`;
          } else if (healthScore >= 60) {
            healthScoreText = `🟡 ${score}/100`;
          } else {
            healthScoreText = `🔴 ${score}/100`;
          }
        }

        // Format vulnerabilities
        let vulnerabilityText = 'None';
        if (hasVulnerabilities || vulnerabilityCount > 0) {
          const count = vulnerabilityCount > 0 ? vulnerabilityCount : 'Yes';
          vulnerabilityText = `⚠️ ${count}`;
        }

        // Check license compatibility
        const licenseCompatibility = this.checkLicenseCompatibility(projectLicense, packageLicense);
        const licenseText = packageLicense || 'Unknown';
        const compatibilityIcon = licenseCompatibility.isCompatible ? '✅' : '❌';
        const licenseCompatibilityText = `${licenseText} ${compatibilityIcon}`;

        comment += `| \`${pkgName}\` | ${healthScoreText} | ${vulnerabilityText} | ${licenseCompatibilityText} | ❌ Not approved |\n`;
      }
      comment += '\n';
      comment += '> **Note:** Please add these packages to your project watchlist and get approval before merging.\n';
    }

    return comment;
  }
}
