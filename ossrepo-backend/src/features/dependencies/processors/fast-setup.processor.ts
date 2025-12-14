import { Process, Processor } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { GitHubApiService } from '../../activity/services/github-api.service';
import { ActivityAnalysisService, CommitData } from '../../activity/services/activity-analysis.service';
import { DependencyQueueService } from '../services/dependency-queue.service';
import { GraphService } from '../../graph/services/graph.service';
import { SbomQueueService } from '../../sbom/services/sbom-queue.service';
interface FastSetupJobData {
  packageId?: string;
  branchDependencyId?: string;
  branchId?: string;
  packageName: string;
  repoUrl?: string;
  projectId: string;
}

@Injectable()
@Processor('dependency-fast-setup')
export class FastSetupProcessor {
  private readonly logger = new Logger(FastSetupProcessor.name);

  constructor(
    private prisma: PrismaService,
    private githubApiService: GitHubApiService,
    private activityAnalysisService: ActivityAnalysisService,
    private dependencyQueueService: DependencyQueueService,
    private readonly graphService: GraphService,
    private readonly sbomQueueService: SbomQueueService,
  ) {
    this.logger.log(`🔧 FastSetupProcessor initialized and ready to process jobs`);
  }

  @Process({ name: 'fast-setup', concurrency: 1 })
  async handleFastSetup(job: Job<FastSetupJobData>) {
    this.logger.log(`🔥 PROCESSOR TRIGGERED! Job ID: ${job.id}, Job Name: ${job.name}`);
    const { packageId, branchDependencyId, branchId, packageName, repoUrl, projectId } = job.data;

    this.logger.log(`🚀 Starting fast setup for package: ${packageName}`);

    let finalPackageId;

    try {
      let currentPackage;

      if (packageId) {
        // Existing flow - package already exists
        currentPackage = await this.prisma.packages.findUnique({
          where: { id: packageId }
        });
        finalPackageId = packageId;

        // If package exists but missing NPM data, fetch it
        if (currentPackage && (!currentPackage.npm_url || !currentPackage.downloads)) {
          this.logger.log(`📦 Package exists but missing NPM data, fetching for: ${packageName}`);
          const npmData = await this.getNpmPackageData(packageName);

          await this.prisma.packages.update({
            where: { id: packageId },
            data: {
              npm_url: npmData.npmUrl || currentPackage.npm_url,
              downloads: npmData.downloads || currentPackage.downloads,
              license: npmData.license || currentPackage.license,
              repo_url: currentPackage.repo_url ?? npmData.repoUrl ?? currentPackage.repo_url,
            }
          });

          // Update currentPackage object for consistency
          currentPackage = {
            ...currentPackage,
            npm_url: npmData.npmUrl || currentPackage.npm_url,
            downloads: npmData.downloads || currentPackage.downloads,
            license: npmData.license || currentPackage.license,
            repo_url: currentPackage.repo_url ?? npmData.repoUrl ?? currentPackage.repo_url,
          };
        }
      } else if (branchDependencyId) {
        // New flow - create or find package, then link to branch dependency
        currentPackage = await this.prisma.packages.findUnique({
          where: { name: packageName }
        });

        if (!currentPackage) {
          // Fetch NPM data for new package
          const npmData = await this.getNpmPackageData(packageName);

          // Create new package with NPM data
          currentPackage = await this.prisma.packages.create({
            data: {
              name: packageName,
              repo_url: repoUrl ?? npmData.repoUrl,
              npm_url: npmData.npmUrl,
              license: npmData.license,
              downloads: npmData.downloads,
              status: 'queued',
            }
          });

          this.logger.log(`📦 Created new package with NPM data: ${packageName}`);
        }
        finalPackageId = currentPackage.id;
      } else {
        throw new Error('Either packageId or branchDependencyId must be provided');
      }
      const effectiveRepoUrl = repoUrl ?? currentPackage?.repo_url ?? null;

      // Check if package is already done - if so, skip analysis and just link
      if (currentPackage?.status === 'done') {
        this.logger.log(`✅ Package ${packageName} is already analyzed, linking to branch dependency`);

        if (effectiveRepoUrl) {
          const repoMatch = effectiveRepoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
          if (repoMatch) {
            const [, owner, repo] = repoMatch;
            const repoSlug = `${owner}/${repo}`.replace(/\.git$/, '');
            const branch = 'main'; // fallback for already-analysed packages

            this.logger.log(
              `🧠 [FastSetup] (status=done) Queuing initial graph build for dependency ${packageName} (${repoSlug}) on branch ${branch}`,
            );

            try {
               await this.graphService.triggerBuild(repoSlug, {
                  branch: branch,
                  startSha: null,
                  commitId: undefined,
                });
            } catch (err: any) {
              this.logger.error(
                `❌ [FastSetup] Failed to queue graph build for already-analysed package ${packageName}: ${err.message}`,
              );
            }

            try {
              // Get package version from branch dependency if available
              let packageVersion: string | undefined = undefined;
              if (branchDependencyId) {
                const branchDep = await this.prisma.branchDependency.findUnique({
                  where: { id: branchDependencyId },
                  select: { version: true }
                });
                packageVersion = branchDep?.version || undefined;
              }
              await this.sbomQueueService.fullProcessSbom(finalPackageId, packageVersion);
              const versionStr = packageVersion ? `@${packageVersion}` : '';
              this.logger.log(`📦 Queued SBOM generation for package: ${packageName}${versionStr}`);
            } catch (sbomError: any) {
              this.logger.warn(`⚠️ Failed to queue SBOM generation for ${packageName}: ${sbomError?.message || sbomError}`);
            }
      
          } else {
            this.logger.warn(
              `⚠️ [FastSetup] Package ${packageName} is done but has an invalid repo URL (${effectiveRepoUrl}), skipping graph build.`,
            );
          }
        } else {
          this.logger.warn(
            `⚠️ [FastSetup] Package ${packageName} is done but has no repo URL, skipping graph build.`,
          );
        }


        // Link the branch dependency and check completion
        if (branchDependencyId && branchId) {
          await this.linkBranchDependencyAndCheckCompletion(branchDependencyId, finalPackageId, branchId, projectId);
        }
        return;
      }

      let updateData: any = { status: 'fast' };

      // If license is not set, try to fetch it from npm (but we may have already fetched it above)
      if (!currentPackage?.license) {
        try {
          const license = await this.getDependencyLicense(packageName);
          if (license) {
            updateData.license = license;
            this.logger.log(`📄 Fetched license for ${packageName}: ${license}`);
          }
        } catch (error) {
          this.logger.log(`⚠️ Could not fetch license for ${packageName}: ${error.message}`);
        }
      }

      await this.prisma.packages.update({
        where: { id: finalPackageId },
        data: updateData
      });

      if (!effectiveRepoUrl) {
        this.logger.log(
          `⚠️ No repository URL available for ${packageName} (job + npm + DB) - skipping GitHub analysis`,
        );

        await this.prisma.packages.update({
          where: { id: finalPackageId },
          data: {
            status: 'done',
            activity_score: null, // No GitHub analysis available
            stars: null,
            contributors: null,
            summary: `Package ${packageName} added to watchlist. No repository URL provided for GitHub analysis.`,
          }
        });

        this.logger.log(`✅ Package ${packageName} added without GitHub analysis`);

        // If this was triggered by a branch dependency, link it and check completion
        if (branchDependencyId && branchId) {
          await this.linkBranchDependencyAndCheckCompletion(branchDependencyId, finalPackageId, branchId, projectId);
        }
        return;
      }

      const repoMatch = effectiveRepoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
      if (!repoMatch) {
        this.logger.log(`⚠️ Invalid GitHub URL for ${packageName}: ${effectiveRepoUrl} - skipping GitHub analysis`);

        // Update package with basic data (invalid URL)
        await this.prisma.packages.update({
          where: { id: finalPackageId },
          data: {
            status: 'done',
            activity_score: null,
            stars: null,
            contributors: null,
            summary: `Package ${packageName} added to watchlist. Invalid GitHub URL: ${effectiveRepoUrl}`,
          }
        });

        this.logger.log(`✅ Package ${packageName} added with invalid URL`);

        // If this was triggered by a branch dependency, link it and check completion
        if (branchDependencyId && branchId) {
          await this.linkBranchDependencyAndCheckCompletion(branchDependencyId, finalPackageId, branchId, projectId);
        }
        return;
      }

      const [, owner, repo] = repoMatch;
      this.logger.log(`🔍 Analyzing repository: ${owner}/${repo}`);

      // Step 2: Get repository info to find the default branch
      this.logger.log(`📡 Fetching repository info to get default branch...`);
      const repoInfo = await this.githubApiService.getRepositoryInfo(owner, repo);
      const defaultBranch = repoInfo.default_branch;
      this.logger.log(`🌿 Default branch: ${defaultBranch}`);

      // Step 3: Fetch recent commits from GitHub API using the correct branch
      this.logger.log(`📡 Fetching recent commits from GitHub API...`);
      let githubCommits;
      try {
        githubCommits = await this.githubApiService.getLatestCommits(owner, repo, defaultBranch, 100);
        this.logger.log(`✅ Fetched ${githubCommits.length} recent commits from ${defaultBranch} branch`);
      } catch (error) {
        this.logger.log(`⚠️ GitHub API error for ${owner}/${repo}: ${error.message} - skipping GitHub analysis`);

        // Update package with basic data (API error)
        await this.prisma.packages.update({
          where: { id: finalPackageId },
          data: {
            status: 'done',
            activity_score: null,
            stars: null,
            contributors: null,
            summary: `Package ${packageName} added to watchlist. GitHub API error: ${error.message}`,
          }
        });

        this.logger.log(`✅ Package ${packageName} added without GitHub analysis (API error)`);

        // If this was triggered by a branch dependency, link it and check completion
        if (branchDependencyId && branchId) {
          await this.linkBranchDependencyAndCheckCompletion(branchDependencyId, finalPackageId, branchId, projectId);
        }
        return;
      }

      // Convert GitHub commits to CommitData format
      const commits: CommitData[] = githubCommits.map(commit => ({
        sha: commit.sha,
        author: commit.commit.author.name,
        email: commit.commit.author.email,
        date: new Date(commit.commit.author.date),
        message: commit.commit.message,
        filesChanged: [], // GitHub API doesn't provide this in basic commit list
        linesAdded: 0,    // Would need to fetch individual commit details
        linesDeleted: 0,  // Would need to fetch individual commit details
      }));

      // Step 3: Calculate activity score using the four measures
      this.logger.log(`🧮 Calculating activity score...`);
      const activityScore = this.activityAnalysisService.calculateActivityScore(commits);
      this.logger.log(`📊 Activity Score: ${activityScore.score}/100 (${activityScore.level})`);
      this.logger.log(`📈 Factors:`, {
        commitFrequency: activityScore.factors.commitFrequency,
        contributorDiversity: activityScore.factors.contributorDiversity,
        codeChurn: activityScore.factors.codeChurn,
        developmentConsistency: activityScore.factors.developmentConsistency,
      });

      // Step 4: Use repository info we already fetched
      this.logger.log(`⭐ Repository has ${repoInfo.stargazers_count} stars`);

      // Calculate contributors from commits
      const uniqueContributors = new Set(commits.map(c => c.author)).size;
      this.logger.log(`👥 Repository has ${uniqueContributors} unique contributors from recent commits`);

      // Step 5: Calculate bus factor score
      this.logger.log(`🚌 Calculating bus factor score...`);
      const busFactorScore = this.calculateBusFactorScore(commits);
      this.logger.log(`🚌 Bus Factor Score: ${busFactorScore.score}/100 (${busFactorScore.riskLevel})`);
      this.logger.log(`📊 Bus Factor Details:`, {
        busFactor: busFactorScore.busFactor,
        totalContributors: busFactorScore.totalContributors,
        topContributorPercentage: busFactorScore.topContributorPercentage,
        riskReason: busFactorScore.riskReason
      });

      // Step 6: Check Scorecard API for existing scores
      this.logger.log(`🛡️ Checking Scorecard API for existing scores...`);
      const scorecardScore = await this.checkScorecardAPI(owner, repo);
      this.logger.log(`🛡️ Scorecard Score: ${scorecardScore.score}/100 (${scorecardScore.source})`);

      // Step 7: Queue scorecard job if no score exists
      if (scorecardScore.score === null) {
        this.logger.log(`📋 No Scorecard score found, queuing scorecard job...`);
        await this.queueScorecardJob(finalPackageId, packageName, effectiveRepoUrl, projectId);
      }

      // Step 8: Check for vulnerabilities using OSV API
      this.logger.log(`🔍 Checking for vulnerabilities using OSV API...`);
      const vulnerabilityScore = await this.checkVulnerabilities(packageName);
      this.logger.log(`🛡️ Vulnerability Score: ${vulnerabilityScore.score}/100 (${vulnerabilityScore.vulnerabilityCount} vulnerabilities)`);

      // Step 9: Check license compliance
      this.logger.log(`📄 Checking license compliance...`);
      const licenseScore = await this.checkLicenseCompliance(owner, repo, packageName);
      this.logger.log(`📄 License Score: ${licenseScore.score}/100 (${licenseScore.licenseType}, ${licenseScore.dependencyIssues} dependency issues)`);

      // Step 10: Calculate total score
      this.logger.log(`🧮 Calculating total health score...`);
      const totalScore = this.calculateTotalScore({
        activity: activityScore.score,
        busFactor: busFactorScore.score,
        scorecard: scorecardScore.score,
        vulnerability: vulnerabilityScore.score,
        license: licenseScore.score
      });
      this.logger.log(`🎯 Total Health Score: ${totalScore.score}/100 (${totalScore.level})`);
      this.logger.log(`📊 Score Breakdown:`, {
        activity: activityScore.score,
        busFactor: busFactorScore.score,
        scorecard: scorecardScore.score,
        vulnerability: vulnerabilityScore.score,
        license: licenseScore.score,
        total: totalScore.score
      });

      // Update package with real data - status stays 'fast' until full-setup completes
      await this.prisma.packages.update({
        where: { id: finalPackageId },
        data: {
          status: 'fast', // Keep as 'fast' - full-setup will set to 'done'
          activity_score: activityScore.score,
          bus_factor_score: busFactorScore.score,
          scorecard_score: scorecardScore.score ? scorecardScore.score * 10 : null, // Multiply by 10 to convert from 0-10 to 0-100 scale
          vulnerability_score: vulnerabilityScore.score,
          license_score: licenseScore.score,
          total_score: totalScore.score,
          stars: repoInfo.stargazers_count,
          contributors: uniqueContributors,
          summary: `Repository analysis completed. Total Health: ${totalScore.level} (${totalScore.score}/100). Activity: ${activityScore.level}, Bus Factor: ${busFactorScore.riskLevel}, Scorecard: ${scorecardScore.source}, Vulnerabilities: ${vulnerabilityScore.vulnerabilityCount}, License: ${licenseScore.licenseType}, Stars: ${repoInfo.stargazers_count}, Contributors: ${uniqueContributors}`,
        }
      });

      this.logger.log(`✅ Fast setup completed for package: ${packageName} (status: fast, awaiting full-setup)`);

      // 🧠 NEW: Queue initial graph build for this dependency's repo
      if (effectiveRepoUrl) {
        try {
          const repoSlug = `${owner}/${repo}`.replace(/\.git$/, '');
          this.logger.log(
            `🧠 [FastSetup] Queuing initial graph build for dependency ${packageName} (${repoSlug}) on branch ${defaultBranch}`,
          );

          await this.graphService.triggerBuild(repoSlug, {
            branch: defaultBranch,
            startSha: null,
            commitId: undefined,
          });
        } catch (err: any) {
          this.logger.error(
            `❌ [FastSetup] Failed to queue graph build for ${packageName}: ${err.message}`,
          );
        }
      }

      // Queue full setup job after fast setup completes
      if (effectiveRepoUrl && finalPackageId) {
        await this.dependencyQueueService.queueFullSetup({
          packageId: finalPackageId,
          packageName,
          repoUrl: effectiveRepoUrl,
          projectId,
        });
        this.logger.log(`📋 Queued full-setup job for package: ${packageName}`);
      }

      // If this was triggered by a branch dependency, link it and check completion
      if (branchDependencyId && branchId) {
        await this.linkBranchDependencyAndCheckCompletion(branchDependencyId, finalPackageId, branchId, projectId);
      }

    } catch (error) {
      this.logger.error(`❌ Fast setup failed for package ${packageName}:`, error);

      // Update package status to failed
      if (finalPackageId) {
        await this.prisma.packages.update({
          where: { id: finalPackageId },
          data: { status: 'failed' }
        });
      }

      throw error;
    } finally {
      // Queue SBOM generation regardless of fast-setup success or failure
      // This ensures SBOM generation is attempted even if fast-setup fails
      if (finalPackageId) {
        try {
          // Get package version from branch dependency if available, otherwise undefined
          let packageVersion: string | undefined = undefined;
          if (branchDependencyId) {
            const branchDep = await this.prisma.branchDependency.findUnique({
              where: { id: branchDependencyId },
              select: { version: true }
            });
            packageVersion = branchDep?.version || undefined;
          }
          await this.sbomQueueService.fullProcessSbom(finalPackageId, packageVersion);
          const versionStr = packageVersion ? `@${packageVersion}` : '';
          this.logger.log(`📦 Queued SBOM generation for package: ${packageName}${versionStr}`);
        } catch (sbomError: any) {
          this.logger.warn(`⚠️ Failed to queue SBOM generation for ${packageName}: ${sbomError?.message || sbomError}`);
        }
      }
    }
  }

  private calculateBusFactorScore(commits: CommitData[]): {
    score: number;
    busFactor: number;
    totalContributors: number;
    topContributorPercentage: number;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    riskReason: string;
  } {
    // Group commits by author
    const contributorStats = new Map<string, number>();
    commits.forEach(commit => {
      const count = contributorStats.get(commit.author) || 0;
      contributorStats.set(commit.author, count + 1);
    });

    // Convert to array and sort by commit count
    const contributors = Array.from(contributorStats.entries())
      .map(([author, totalCommits]) => ({ author, totalCommits }))
      .sort((a, b) => b.totalCommits - a.totalCommits);

    const totalCommits = contributors.reduce((sum, c) => sum + c.totalCommits, 0);
    const totalContributors = contributors.length;

    if (totalContributors === 0) {
      return {
        score: 0,
        busFactor: 0,
        totalContributors: 0,
        topContributorPercentage: 0,
        riskLevel: 'CRITICAL',
        riskReason: 'No contributors found'
      };
    }

    if (totalContributors === 1) {
      return {
        score: 0,
        busFactor: 1,
        totalContributors: 1,
        topContributorPercentage: 1,
        riskLevel: 'CRITICAL',
        riskReason: 'Only one contributor - critical bus factor risk'
      };
    }

    const topContributor = contributors[0];
    const topContributorPercentage = topContributor.totalCommits / totalCommits;

    let busFactor: number;
    if (topContributorPercentage > 0.5) {
      busFactor = 1;
    } else {
      // Calculate how many contributors needed to reach 50% of commits
      let cumulativeCommits = 0;
      let contributorsNeeded = 0;
      const targetCommits = totalCommits * 0.5;

      for (const contributor of contributors) {
        cumulativeCommits += contributor.totalCommits;
        contributorsNeeded++;
        if (cumulativeCommits >= targetCommits) {
          break;
        }
      }
      busFactor = contributorsNeeded;
    }

    // Convert bus factor to 0-100 score (lower bus factor = higher risk = lower score)
    let score: number;
    if (busFactor === 1) score = 0;
    else if (busFactor <= 2) score = 25;
    else if (busFactor <= 3) score = 50;
    else if (busFactor <= 5) score = 75;
    else score = 100;

    // Determine risk level
    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    if (totalContributors <= 2 || busFactor === 1 || topContributorPercentage > 0.8) {
      riskLevel = 'CRITICAL';
    } else if (busFactor <= 3 || topContributorPercentage > 0.6) {
      riskLevel = 'HIGH';
    } else if (busFactor <= 6 || topContributorPercentage > 0.4) {
      riskLevel = 'MEDIUM';
    } else {
      riskLevel = 'LOW';
    }

    const riskReason = this.getBusFactorRiskReason(riskLevel, busFactor, totalContributors, topContributorPercentage);

    return {
      score,
      busFactor,
      totalContributors,
      topContributorPercentage,
      riskLevel,
      riskReason
    };
  }

  private getBusFactorRiskReason(
    riskLevel: string,
    busFactor: number,
    totalContributors: number,
    topContributorPercentage: number
  ): string {
    const percentage = (topContributorPercentage * 100).toFixed(1);

    switch (riskLevel) {
      case 'CRITICAL':
        if (totalContributors <= 2) {
          return `Critical risk: Very few contributors (${totalContributors} total). Bus factor of ${busFactor}.`;
        } else if (busFactor === 1) {
          return `Critical risk: Bus factor of ${busFactor}. Top contributor has ${percentage}% of commits - extreme concentration of knowledge.`;
        } else {
          return `Critical risk: Bus factor of ${busFactor}. Top contributor has ${percentage}% of commits.`;
        }
      case 'HIGH':
        return `High risk: Bus factor of ${busFactor}. Top contributor has ${percentage}% of commits - significant knowledge concentration.`;
      case 'MEDIUM':
        return `Medium risk: Bus factor of ${busFactor}. Top contributor has ${percentage}% of commits - moderate knowledge concentration.`;
      case 'LOW':
        return `Low risk: Good contributor distribution with bus factor of ${busFactor}. Top contributor has ${percentage}% of commits.`;
      default:
        return `Unknown risk level: Bus factor of ${busFactor}.`;
    }
  }

  private async checkScorecardAPI(owner: string, repo: string): Promise<{
    score: number | null;
    source: string;
  }> {
    try {
      // Check Scorecard API for existing scores
      const scorecardUrl = `https://api.securityscorecards.dev/projects/github.com/${owner}/${repo}`;
      this.logger.log(`🔍 Checking Scorecard API: ${scorecardUrl}`);

      const response = await fetch(scorecardUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'OSS-Repository-Backend'
        }
      });

      if (response.ok) {
        const data = await response.json();
        const score = data.score || null;
        this.logger.log(`✅ Scorecard API found score: ${score}`);
        return {
          score,
          source: 'scorecard-api'
        };
      } else {
        this.logger.log(`⚠️ Scorecard API returned ${response.status}: ${response.statusText}`);
        return {
          score: null,
          source: 'not-found'
        };
      }
    } catch (error) {
      this.logger.log(`❌ Scorecard API error: ${error.message}`);
      return {
        score: null,
        source: 'api-error'
      };
    }
  }

  private async queueScorecardJob(
    packageId: string,
    packageName: string,
    repoUrl: string,
    projectId: string
  ): Promise<void> {
    try {
      this.logger.log(`📋 Queuing scorecard job for ${packageName} (${packageId})`);
      this.logger.log(`📋 Repository: ${repoUrl}`);
      this.logger.log(`📋 Project: ${projectId}`);

      // Queue the scorecard priority job
      await this.dependencyQueueService.queueScorecardPriority({
        packageId,
        packageName,
        repoUrl,
        projectId
      });

      this.logger.log(`✅ Scorecard job queued successfully for ${packageName}`);

    } catch (error) {
      this.logger.error(`❌ Failed to queue scorecard job: ${error.message}`);
    }
  }

  private async checkVulnerabilities(packageName: string): Promise<{
    score: number;
    vulnerabilityCount: number;
    severity: string;
  }> {
    try {
      // Call OSV API to check for vulnerabilities
      const osvUrl = 'https://api.osv.dev/v1/query';
      this.logger.log(`🔍 Checking OSV API for vulnerabilities: ${packageName}`);

      const response = await fetch(osvUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          package: {
            name: packageName,
            ecosystem: 'npm' // Assuming npm packages for now
          }
        })
      });

      if (!response.ok) {
        this.logger.log(`⚠️ OSV API returned ${response.status}: ${response.statusText}`);
        return {
          score: 100, // Assume no vulnerabilities if API fails
          vulnerabilityCount: 0,
          severity: 'unknown'
        };
      }

      const data = await response.json();
      const vulnerabilities = data.vulns || [];

      this.logger.log(`🔍 Found ${vulnerabilities.length} vulnerabilities for ${packageName}`);

      if (vulnerabilities.length === 0) {
        return {
          score: 100,
          vulnerabilityCount: 0,
          severity: 'none'
        };
      }

      // Analyze vulnerability severity
      let criticalCount = 0;
      let highCount = 0;
      let mediumCount = 0;
      let lowCount = 0;

      for (const vuln of vulnerabilities) {
        const severity = vuln.severity?.[0]?.score || 'unknown';
        if (severity >= 9.0) criticalCount++;
        else if (severity >= 7.0) highCount++;
        else if (severity >= 4.0) mediumCount++;
        else lowCount++;
      }

      // Calculate score based on severity and count
      let score: number;
      let severity: string;

      if (criticalCount > 0) {
        score = 0;
        severity = 'critical';
      } else if (highCount >= 3) {
        score = 25;
        severity = 'high';
      } else if (highCount > 0 || mediumCount >= 5) {
        score = 50;
        severity = 'medium';
      } else if (mediumCount > 0 || lowCount >= 3) {
        score = 75;
        severity = 'low';
      } else if (lowCount > 0) {
        score = 75; // 1-2 low severity vulnerabilities
        severity = 'low';
      } else {
        score = 100;
        severity = 'minimal';
      }

      this.logger.log(`🛡️ Vulnerability analysis: ${vulnerabilities.length} total, ${criticalCount} critical, ${highCount} high, ${mediumCount} medium, ${lowCount} low`);

      return {
        score,
        vulnerabilityCount: vulnerabilities.length,
        severity
      };

    } catch (error) {
      this.logger.error(`❌ OSV API error: ${error.message}`);
      return {
        score: 100, // Assume no vulnerabilities if API fails
        vulnerabilityCount: 0,
        severity: 'api-error'
      };
    }
  }

  private async checkLicenseCompliance(owner: string, repo: string, packageName: string): Promise<{
    score: number;
    licenseType: string;
    dependencyIssues: number;
  }> {
    try {
      this.logger.log(`📄 Checking license compliance for ${owner}/${repo}`);

      // Step 1: Get package.json from GitHub
      const packageJson = await this.githubApiService.getPackageJson(owner, repo);
      if (!packageJson) {
        this.logger.log(`⚠️ No package.json found for ${owner}/${repo}`);
        return {
          score: 50, // Unknown license
          licenseType: 'unknown',
          dependencyIssues: 0
        };
      }

      // Step 2: Check project's own license
      const projectLicense = packageJson.license || 'unlicensed';
      this.logger.log(`📄 Project license: ${projectLicense}`);

      let projectLicenseScore = this.scoreProjectLicense(projectLicense);

      // Step 3: Check dependencies licenses
      const dependencies = packageJson.dependencies || {};
      const devDependencies = packageJson.devDependencies || {};
      const allDependencies = { ...dependencies, ...devDependencies };

      this.logger.log(`📦 Checking ${Object.keys(allDependencies).length} dependencies for license compliance`);

      let dependencyIssues = 0;
      const dependencyLicenseChecks = [];

      // Check each dependency's license
      for (const [depName, depVersion] of Object.entries(allDependencies)) {
        try {
          const depLicense = await this.getDependencyLicense(depName);
          if (depLicense) {
            dependencyLicenseChecks.push({ name: depName, license: depLicense });

            // Check for license conflicts
            if (this.hasLicenseConflict(projectLicense, depLicense)) {
              dependencyIssues++;
              this.logger.log(`⚠️ License conflict: ${depName} (${depLicense}) conflicts with project license (${projectLicense})`);
            }
          }
        } catch (error) {
          this.logger.log(`⚠️ Could not check license for ${depName}: ${error.message}`);
        }
      }

      // Step 4: Calculate final score
      const dependencyScore = Math.max(0, 100 - (dependencyIssues * 20)); // -20 points per conflict
      const finalScore = Math.round((projectLicenseScore + dependencyScore) / 2);

      this.logger.log(`📄 License analysis: Project=${projectLicenseScore}/100, Dependencies=${dependencyScore}/100, Conflicts=${dependencyIssues}`);

      return {
        score: finalScore,
        licenseType: projectLicense,
        dependencyIssues
      };

    } catch (error) {
      this.logger.error(`❌ License compliance check failed: ${error.message}`);
      return {
        score: 50, // Unknown/error
        licenseType: 'error',
        dependencyIssues: 0
      };
    }
  }

  private scoreProjectLicense(license: string): number {
    const licenseLower = license.toLowerCase();

    // Permissive licenses (good)
    if (licenseLower.includes('mit') || licenseLower.includes('apache-2.0') ||
        licenseLower.includes('bsd-3-clause') || licenseLower.includes('bsd-2-clause')) {
      return 100;
    }

    // Other permissive licenses
    if (licenseLower.includes('bsd') || licenseLower.includes('isc') ||
        licenseLower.includes('unlicense') || licenseLower.includes('cc0')) {
      return 90;
    }

    // Copyleft licenses (restrictive but acceptable)
    if (licenseLower.includes('gpl-3.0') || licenseLower.includes('gpl-2.0')) {
      return 70;
    }

    // Very restrictive licenses
    if (licenseLower.includes('agpl') || licenseLower.includes('copyleft')) {
      return 50;
    }

    // Unlicensed or unknown
    if (licenseLower.includes('unlicensed') || licenseLower.includes('proprietary') ||
        license === 'unlicensed' || !license) {
      return 20;
    }

    // Unknown license
    return 60;
  }

  private async getDependencyLicense(depName: string): Promise<string | null> {
    try {
      const npmUrl = `https://registry.npmjs.org/${depName}`;
      const response = await fetch(npmUrl);

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data.license || null;
    } catch (error) {
      return null;
    }
  }

  private async getNpmPackageData(packageName: string): Promise<{
    npmUrl: string | null;
    downloads: number | null;
    license: string | null;
    repoUrl: string | null;
  }> {
    try {
      this.logger.log(`📦 Fetching NPM data for package: ${packageName}`);

      const npmUrl = `https://registry.npmjs.org/${packageName}`;
      const response = await fetch(npmUrl);

      if (!response.ok) {
        this.logger.log(`⚠️ NPM API returned ${response.status} for ${packageName}`);
        return {
          npmUrl: null,
          downloads: null,
          license: null,
          repoUrl: null
        };
      }

      const data = await response.json();
      const repository = data.repository;
      // npm registry can return things like:
      // { "repository": { "type": "git", "url": "git+https://github.com/facebook/react.git" } }
      let repoUrl: string | null = null;

      if (repository && typeof repository === 'object') {
        const rawUrl = repository.url as string | undefined;
        if (rawUrl) {
          // strip "git+" prefix and ".git" suffix if present
          repoUrl = rawUrl.replace(/^git\+/, '').replace(/\.git$/, '');
        }
      }
      // Get download stats from npm API
      let downloads = null;
      try {
        const downloadStatsUrl = `https://api.npmjs.org/downloads/point/last-month/${packageName}`;
        const downloadResponse = await fetch(downloadStatsUrl);
        if (downloadResponse.ok) {
          const downloadData = await downloadResponse.json();
          downloads = downloadData.downloads || 0;
        }
      } catch (error) {
        this.logger.log(`⚠️ Could not fetch download stats for ${packageName}: ${error.message}`);
      }

      const result = {
        npmUrl: `https://www.npmjs.com/package/${packageName}`,
        downloads,
        license: data.license || null,
        repoUrl,
      };

      this.logger.log(`✅ NPM data for ${packageName}: downloads=${downloads}, license=${result.license}`);
      return result;

    } catch (error) {
      this.logger.error(`❌ Error fetching NPM data for ${packageName}:`, error);
      return {
        npmUrl: null,
        downloads: null,
        license: null,
        repoUrl: null
      };
    }
  }

  private hasLicenseConflict(projectLicense: string, dependencyLicense: string): boolean {
    const projectLower = projectLicense.toLowerCase();
    const depLower = dependencyLicense.toLowerCase();

    // GPL dependencies in non-GPL projects
    if (depLower.includes('gpl') && !projectLower.includes('gpl')) {
      return true;
    }

    // AGPL dependencies in non-AGPL projects
    if (depLower.includes('agpl') && !projectLower.includes('agpl')) {
      return true;
    }

    // Copyleft dependencies in permissive projects
    if ((depLower.includes('copyleft') || depLower.includes('gpl')) &&
        (projectLower.includes('mit') || projectLower.includes('apache') || projectLower.includes('bsd'))) {
      return true;
    }

    return false;
  }

  private calculateTotalScore(scores: {
    activity: number;
    busFactor: number;
    scorecard: number;
    vulnerability: number;
    license: number;
  }): {
    score: number;
    level: string;
  } {
    // Calculate average of all scores
    const totalScore = Math.round(
      (scores.activity + scores.busFactor + scores.scorecard + scores.vulnerability + scores.license) / 5
    );

    // Determine health level
    let level: string;
    if (totalScore >= 90) {
      level = 'EXCELLENT';
    } else if (totalScore >= 80) {
      level = 'VERY_GOOD';
    } else if (totalScore >= 70) {
      level = 'GOOD';
    } else if (totalScore >= 60) {
      level = 'FAIR';
    } else if (totalScore >= 50) {
      level = 'POOR';
    } else {
      level = 'CRITICAL';
    }

    return {
      score: totalScore,
      level
    };
  }

  private async linkBranchDependencyAndCheckCompletion(
    branchDependencyId: string,
    packageId: string,
    branchId: string,
    projectId: string
  ): Promise<void> {
    try {
      // Link the branch dependency to the package
      await this.prisma.branchDependency.update({
        where: { id: branchDependencyId },
        data: { package_id: packageId }
      });

      this.logger.log(`🔗 Linked branch dependency ${branchDependencyId} to package ${packageId}`);

      // Check if all dependencies for this branch are complete
      const allDependencies = await this.prisma.branchDependency.findMany({
        where: { monitored_branch_id: branchId },
        include: { package: true }
      });

      const completedDependencies = allDependencies.filter(dep =>
        dep.package_id && dep.package && dep.package.status === 'done'
      );

      this.logger.log(`📊 Branch ${branchId} progress: ${completedDependencies.length}/${allDependencies.length} dependencies complete`);

      // If all dependencies are complete, update project status
      if (completedDependencies.length === allDependencies.length) {
        this.logger.log(`🎉 All dependencies complete for branch ${branchId}, marking project ${projectId} as ready`);

        // Calculate average health score from all completed dependencies
        const totalScores = completedDependencies
          .map(dep => dep.package?.total_score)
          .filter(score => score !== null && score !== undefined);

        const averageHealthScore = totalScores.length > 0
          ? totalScores.reduce((sum, score) => sum + score, 0) / totalScores.length
          : null;

        this.logger.log(`📊 Calculated average health score: ${averageHealthScore?.toFixed(2) || 'N/A'}`);

        // Find all projects using this branch and mark them as ready
        const projects = await this.prisma.project.findMany({
          where: { monitored_branch_id: branchId }
        });

        for (const project of projects) {
          await this.prisma.project.update({
            where: { id: project.id },
            data: {
              status: 'ready',
              health_score: averageHealthScore
            }
          });
          this.logger.log(`✅ Project ${project.id} marked as ready with health score: ${averageHealthScore?.toFixed(2) || 'N/A'}`);
        }
      }
    } catch (error) {
      this.logger.error(`❌ Error linking branch dependency and checking completion:`, error);
      throw error;
    }
  }
}