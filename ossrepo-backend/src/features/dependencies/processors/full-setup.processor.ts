import { Process, Processor } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { GitManagerService } from '../../activity/services/git-manager.service';
import { GitCommitExtractorService, CommitDetails } from '../services/git-commit-extractor.service';
import { PackageScorecardService } from '../services/package-scorecard.service';
import { AISummaryService } from '../../activity/services/ai-summary.service';
import { PackageVulnerabilityService } from '../services/package-vulnerability.service';
import { MonthlyCommitsService } from '../services/monthly-commits.service';
import { AnomalyDetectionService } from '../services/anomaly-detection.service';
import * as path from 'path';
import * as fs from 'fs';

interface FullSetupJobData {
  packageId: string;
  packageName: string;
  repoUrl?: string;
  projectId: string;
}

@Injectable()
@Processor('dependency-full-setup')
export class FullSetupProcessor {
  private readonly logger = new Logger(FullSetupProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gitManager: GitManagerService,
    private readonly gitCommitExtractor: GitCommitExtractorService,
    private readonly packageScorecard: PackageScorecardService,
    private readonly aiSummaryService: AISummaryService,
    private readonly packageVulnerability: PackageVulnerabilityService,
    private readonly monthlyCommits: MonthlyCommitsService,
    private readonly anomalyDetection: AnomalyDetectionService,
  ) {
    this.logger.log(`🔧 FullSetupProcessor initialized and ready to process jobs`);
  }

  @Process({ name: 'full-setup', concurrency: 1 })
  async handleFullSetup(job: Job<FullSetupJobData>) {
    this.logger.log(`🔥 FULL SETUP PROCESSOR TRIGGERED! Job ID: ${job.id}`);
    const { packageId, packageName, repoUrl, projectId } = job.data;
    
    this.logger.log(`🚀 Starting full setup for package: ${packageName}`);
    
    let repoPath: string | null = null;
    let owner: string | null = null;
    let repo: string | null = null;

    try {
      // 1. Validate package and get repository info
      const packageRecord = await this.prisma.packages.findUnique({
        where: { id: packageId }
      });

      if (!packageRecord) {
        throw new Error(`Package ${packageId} not found`);
      }

      if (!repoUrl) {
        this.logger.log(`⚠️ No repository URL for ${packageName}, skipping full setup`);
        await this.updatePackageStatus(packageId, 'done');
        return;
      }

      // 2. Extract owner/repo from URL
      const githubMatch = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
      if (!githubMatch) {
        this.logger.log(`⚠️ Invalid GitHub URL for ${packageName}: ${repoUrl}`);
        await this.updatePackageStatus(packageId, 'done');
        return;
      }

      [, owner, repo] = githubMatch;
      this.logger.log(`📦 Processing repository: ${owner}/${repo}`);

      // 3. Clone repository with depth 5000
      repoPath = await this.cloneRepositoryWithDepth(owner, repo);
      this.logger.log(`✅ Repository cloned to: ${repoPath}`);

      // 4. Extract commits (up to 5000)
      const allCommits = await this.gitCommitExtractor.extractCommitsFromRepo(repoPath, 5000);
      this.logger.log(`📊 Extracted ${allCommits.length} commits`);

      // 5. Store most recent 100 commits
      const recentCommits = allCommits.slice(0, 100);
      await this.storeRecentCommits(packageId, recentCommits);
      this.logger.log(`💾 Stored ${recentCommits.length} recent commits`);

      // 6. Aggregate monthly commits for activity tracking
      await this.monthlyCommits.aggregateMonthlyCommits(packageId, allCommits);
      this.logger.log(`📊 Aggregated monthly commits`);

      // 7. Build contributor profiles from all commits
      const contributorProfiles = this.buildContributorProfiles(allCommits);
      await this.storeContributorProfiles(packageId, contributorProfiles);
      this.logger.log(`👥 Built ${contributorProfiles.length} contributor profiles`);

      // 8. Detect anomalies in stored commits
      await this.detectAnomaliesInStoredCommits(packageId, recentCommits);
      this.logger.log(`🔍 Detected anomalies in stored commits`);

      // 9. Scorecard - DISABLED (too slow for full-setup, uses API result from fast-setup instead)
      // The API scorecard is fetched during fast-setup which is sufficient
      // Historical scorecard analysis was causing timeouts on large repos
      this.logger.log(`⏭️ Skipping scorecard in full-setup (using API result from fast-setup)`);

      // 10. Process vulnerabilities (NPM versions + OSV API)
      await this.packageVulnerability.processPackageVulnerabilities(packageId, packageName);
      this.logger.log(`🔍 Processed package vulnerabilities`);

      // 11. Generate AI overview
      await this.generateAIOverview(packageId, packageName, allCommits, contributorProfiles);
      this.logger.log(`🤖 Generated AI overview`);

      // 12. Update package status to 'done'
      await this.updatePackageStatus(packageId, 'done');
      this.logger.log(`✅ Full setup completed for ${packageName}`);

    } catch (error) {
      this.logger.error(`❌ Full setup failed for ${packageName}:`, error);
      
      // Update package status to indicate failure
      await this.prisma.packages.update({
        where: { id: packageId },
        data: { 
          status: 'done', // Still mark as done to prevent retry loops
          summary: `Full setup failed: ${error.message}`
        }
      });
      
      throw error;
    } finally {
      // 10. Cleanup cloned repository
      if (repoPath && owner && repo) {
        await this.cleanupClonedRepo(owner, repo);
        this.logger.log(`🧹 Cleaned up repository: ${owner}/${repo}`);
      }
    }
  }

  /**
   * Clone repository with depth up to 5000 commits
   */
  private async cloneRepositoryWithDepth(owner: string, repo: string): Promise<string> {
    try {
      // First try to get the default branch from GitHub API
      let defaultBranch = 'main';
      try {
        const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
        if (response.ok) {
          const repoData = await response.json();
          defaultBranch = repoData.default_branch || 'main';
          this.logger.log(`📋 Using default branch '${defaultBranch}' for ${owner}/${repo}`);
        }
      } catch (apiError) {
        this.logger.warn(`⚠️ Could not fetch default branch for ${owner}/${repo}, using 'main'`);
      }

      // Try cloning with the detected default branch
      let repoPath: string;
      try {
        repoPath = await this.gitManager.cloneRepository(owner, repo, defaultBranch, 5000);
      } catch (cloneError) {
        // If main branch fails, try master as fallback
        if (defaultBranch === 'main') {
          this.logger.log(`🔄 Main branch failed, trying 'master' branch for ${owner}/${repo}`);
          try {
            repoPath = await this.gitManager.cloneRepository(owner, repo, 'master', 5000);
          } catch (masterError) {
            // If both fail, try without specifying branch (clone default)
            this.logger.log(`🔄 Both main and master failed, trying default branch for ${owner}/${repo}`);
            repoPath = await this.gitManager.cloneRepository(owner, repo, undefined, 5000);
          }
        } else {
          throw cloneError;
        }
      }
      
      // Verify the clone was successful
      if (!fs.existsSync(repoPath)) {
        throw new Error(`Repository clone failed: ${repoPath} does not exist`);
      }

      return repoPath;
    } catch (error) {
      this.logger.error(`❌ Failed to clone repository ${owner}/${repo}:`, error);
      throw new Error(`Failed to clone repository: ${error.message}`);
    }
  }

  /**
   * Store most recent commits in database
   */
  private async storeRecentCommits(packageId: string, commits: CommitDetails[]): Promise<void> {
    try {
      const commitData = commits.map(commit => ({
        package_id: packageId,
        sha: commit.sha,
        author: commit.author,
        author_email: commit.authorEmail,
        message: commit.message,
        timestamp: commit.timestamp,
        lines_added: commit.linesAdded,
        lines_deleted: commit.linesDeleted,
        files_changed: commit.filesChanged,
        diff_data: commit.diffData,
      }));

      // Use createMany for better performance
      await this.prisma.packageCommit.createMany({
        data: commitData,
        skipDuplicates: true
      });

      this.logger.log(`💾 Stored ${commits.length} commits for package ${packageId}`);
    } catch (error) {
      this.logger.error(`❌ Failed to store commits:`, error);
      throw error;
    }
  }

  /**
   * Build contributor profiles from all commits
   */
  private buildContributorProfiles(commits: CommitDetails[]): any[] {
    const contributorMap = new Map<string, any>();

    for (const commit of commits) {
      const email = commit.authorEmail;
      
      if (!contributorMap.has(email)) {
        contributorMap.set(email, {
          author_email: email,
          author_name: commit.author,
          total_commits: 0,
          lines_added: [],
          lines_deleted: [],
          files_changed: [],
          timestamps: [],
          message_lengths: [], // Track commit message lengths
          files_worked_on: new Map<string, number>(), // Track files worked on
        });
      }

      const profile = contributorMap.get(email);
      profile.total_commits++;
      profile.lines_added.push(commit.linesAdded);
      profile.lines_deleted.push(commit.linesDeleted);
      profile.files_changed.push(commit.filesChanged);
      profile.timestamps.push(commit.timestamp);
      profile.message_lengths.push(commit.message.length);

      // Track files worked on from diff data
      if (commit.diffData && commit.diffData.filesChanged) {
        for (const file of commit.diffData.filesChanged) {
          const currentCount = profile.files_worked_on.get(file) || 0;
          profile.files_worked_on.set(file, currentCount + 1);
        }
      }
    }

    // Calculate statistics for each contributor
    const profiles = Array.from(contributorMap.values()).map(profile => {
      const linesAdded = profile.lines_added;
      const linesDeleted = profile.lines_deleted;
      const filesChanged = profile.files_changed;
      const timestamps = profile.timestamps;
      const messageLengths = profile.message_lengths;

      // Calculate averages
      const avgLinesAdded = linesAdded.reduce((a, b) => a + b, 0) / linesAdded.length;
      const avgLinesDeleted = linesDeleted.reduce((a, b) => a + b, 0) / linesDeleted.length;
      const avgFilesChanged = filesChanged.reduce((a, b) => a + b, 0) / filesChanged.length;
      const avgCommitMessageLength = messageLengths.reduce((a, b) => a + b, 0) / messageLengths.length;

      // Calculate standard deviations
      const stddevLinesAdded = this.calculateStandardDeviation(linesAdded);
      const stddevLinesDeleted = this.calculateStandardDeviation(linesDeleted);
      const stddevFilesChanged = this.calculateStandardDeviation(filesChanged);
      const stddevCommitMessageLength = this.calculateStandardDeviation(messageLengths);

      // Calculate insert-to-delete ratio
      const totalLinesAdded = linesAdded.reduce((a, b) => a + b, 0);
      const totalLinesDeleted = linesDeleted.reduce((a, b) => a + b, 0);
      const insertToDeleteRatio = totalLinesDeleted === 0 ? 999 : totalLinesAdded / totalLinesDeleted;

      // Build time histogram
      const commitTimeHistogram = this.buildCommitTimeHistogram(timestamps);
      const typicalDaysActive = this.buildTypicalDaysActive(timestamps);
      const commitTimeHeatmap = this.buildCommitTimeHeatmap(timestamps);

      // Convert files worked on Map to object for JSON storage
      const filesWorkedOnHistogram = Object.fromEntries(profile.files_worked_on);

      // Ensure we have valid dates
      const validTimestamps = timestamps.filter(t => t && !isNaN(t.getTime()));
      if (validTimestamps.length === 0) {
        this.logger.warn(`⚠️ No valid timestamps for contributor ${profile.author_email}`);
        return null; // Skip this contributor
      }

      const firstCommitDate = new Date(Math.min(...validTimestamps.map(t => t.getTime())));
      const lastCommitDate = new Date(Math.max(...validTimestamps.map(t => t.getTime())));

      // Validate dates before returning
      if (isNaN(firstCommitDate.getTime()) || isNaN(lastCommitDate.getTime())) {
        this.logger.warn(`⚠️ Invalid dates for contributor ${profile.author_email}`);
        return null; // Skip this contributor
      }

      return {
        author_email: profile.author_email,
        author_name: profile.author_name,
        total_commits: profile.total_commits,
        avg_lines_added: avgLinesAdded,
        avg_lines_deleted: avgLinesDeleted,
        avg_files_changed: avgFilesChanged,
        stddev_lines_added: stddevLinesAdded,
        stddev_lines_deleted: stddevLinesDeleted,
        stddev_files_changed: stddevFilesChanged,
        avg_commit_message_length: avgCommitMessageLength,
        stddev_commit_message_length: stddevCommitMessageLength,
        insert_to_delete_ratio: insertToDeleteRatio,
        commit_time_histogram: commitTimeHistogram,
        typical_days_active: typicalDaysActive,
        commit_time_heatmap: commitTimeHeatmap,
        files_worked_on: filesWorkedOnHistogram,
        first_commit_date: firstCommitDate,
        last_commit_date: lastCommitDate,
      };
    });

    return profiles;
  }

  /**
   * Store contributor profiles in database
   */
  private async storeContributorProfiles(packageId: string, profiles: any[]): Promise<void> {
    try {
      // Filter out null profiles (invalid contributors)
      const validProfiles = profiles.filter(profile => profile !== null);
      
      if (validProfiles.length === 0) {
        this.logger.warn(`⚠️ No valid contributor profiles to store for package ${packageId}`);
        return;
      }

      const profileData = validProfiles.map(profile => ({
        package_id: packageId,
        author_email: profile.author_email,
        author_name: profile.author_name,
        total_commits: profile.total_commits,
        avg_lines_added: profile.avg_lines_added,
        avg_lines_deleted: profile.avg_lines_deleted,
        avg_files_changed: profile.avg_files_changed,
        stddev_lines_added: profile.stddev_lines_added,
        stddev_lines_deleted: profile.stddev_lines_deleted,
        stddev_files_changed: profile.stddev_files_changed,
        avg_commit_message_length: profile.avg_commit_message_length,
        stddev_commit_message_length: profile.stddev_commit_message_length,
        insert_to_delete_ratio: profile.insert_to_delete_ratio,
        commit_time_histogram: profile.commit_time_histogram,
        typical_days_active: profile.typical_days_active,
        commit_time_heatmap: profile.commit_time_heatmap,
        files_worked_on: profile.files_worked_on,
        first_commit_date: profile.first_commit_date,
        last_commit_date: profile.last_commit_date,
      }));

      await this.prisma.packageContributor.createMany({
        data: profileData,
        skipDuplicates: true
      });

      this.logger.log(`👥 Stored ${validProfiles.length} contributor profiles for package ${packageId}`);
    } catch (error) {
      this.logger.error(`❌ Failed to store contributor profiles:`, error);
      throw error;
    }
  }

  /**
   * Detect anomalies in stored commits during full setup
   */
  private async detectAnomaliesInStoredCommits(packageId: string, commits: CommitDetails[]): Promise<void> {
    try {
      let anomalyCount = 0;

      for (const commit of commits) {
        try {
          // Get contributor profile
          const contributor = await this.prisma.packageContributor.findUnique({
            where: {
              package_id_author_email: {
                package_id: packageId,
                author_email: commit.authorEmail,
              },
            },
          });

          if (!contributor) {
            // Skip if contributor profile doesn't exist (shouldn't happen, but safety check)
            continue;
          }

          // Calculate anomaly score
          const result = this.anomalyDetection.calculateAnomalyScore(
            commit,
            contributor as any,
          );

          // Only store if score > 0
          if (result.totalScore > 0) {
            await this.prisma.packageAnomaly.create({
              data: {
                package_id: packageId,
                commit_sha: commit.sha,
                contributor_id: contributor.id,
                anomaly_score: result.totalScore,
                score_breakdown: result.breakdown,
              },
            });

            anomalyCount++;
          }
        } catch (error) {
          this.logger.error(`Error detecting anomalies for commit ${commit.sha}:`, error);
          // Continue with other commits
        }
      }

      this.logger.log(`🔍 Detected ${anomalyCount} anomalous commits out of ${commits.length} total`);
    } catch (error) {
      this.logger.error(`❌ Failed to detect anomalies in stored commits:`, error);
      // Don't throw - anomaly detection failure shouldn't fail the entire setup
    }
  }

  /**
   * Generate AI overview using commit data and contributor profiles
   */
  private async generateAIOverview(
    packageId: string,
    packageName: string,
    commits: CommitDetails[],
    contributors: any[]
  ): Promise<void> {
    try {
      // Get latest scorecard score
      const latestScore = await this.packageScorecard.getLatestScore(packageId);
      
      // Build repository data for AI summary
      const repoData = {
        name: packageName,
        description: `Repository analysis for ${packageName}`,
        stars: 0, // Will be updated from GitHub API if needed
        forks: 0,
        contributors: contributors.length,
        language: 'Unknown',
        topics: [],
        lastCommitDate: commits.length > 0 ? commits[0].timestamp : new Date(),
        commitCount: commits.length,
        busFactor: this.calculateBusFactor(contributors),
        recentCommits: commits.slice(0, 10).map(commit => ({
          message: commit.message,
          author: commit.author,
          date: commit.timestamp,
          filesChanged: commit.filesChanged,
        })),
        healthAnalysis: {
          latestHealthScore: latestScore || 0,
          healthSource: latestScore ? 'scorecard' : 'unknown',
        },
      };

      // Generate AI summary
      const summary = await this.aiSummaryService.generateRepositorySummary(repoData);
      
      // Update package with summary
      await this.prisma.packages.update({
        where: { id: packageId },
        data: { 
          summary: summary.summary,
          contributors: contributors.length,
        }
      });

      this.logger.log(`🤖 Generated AI overview for ${packageName}`);
    } catch (error) {
      this.logger.error(`❌ Failed to generate AI overview:`, error);
      // Don't throw - this is not critical
    }
  }

  /**
   * Update package status
   */
  private async updatePackageStatus(packageId: string, status: string): Promise<void> {
    try {
      await this.prisma.packages.update({
        where: { id: packageId },
        data: { status }
      });
    } catch (error) {
      this.logger.error(`❌ Failed to update package status:`, error);
      throw error;
    }
  }

  /**
   * Cleanup cloned repository
   */
  private async cleanupClonedRepo(owner: string, repo: string): Promise<void> {
    try {
      await this.gitManager.cleanupRepository(owner, repo);
    } catch (error) {
      this.logger.error(`❌ Failed to cleanup repository ${owner}/${repo}:`, error);
      // Don't throw - cleanup failure shouldn't fail the job
    }
  }

  // Helper methods for statistics calculation
  private calculateStandardDeviation(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  private buildCommitTimeHistogram(timestamps: Date[]): any {
    const histogram: { [key: string]: number } = {};
    
    for (const timestamp of timestamps) {
      const hour = timestamp.getHours();
      const key = `${hour}:00`;
      histogram[key] = (histogram[key] || 0) + 1;
    }
    
    return histogram;
  }

  private buildTypicalDaysActive(timestamps: Date[]): any {
    const daysActive: { [key: string]: number } = {};
    
    for (const timestamp of timestamps) {
      const dayOfWeek = timestamp.getDay();
      const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek];
      daysActive[dayName] = (daysActive[dayName] || 0) + 1;
    }
    
    return daysActive;
  }

  /**
   * Build commit time heatmap (7x24 grid) from timestamps
   * Format: [day][hour] where day is 0-6 (Sunday-Saturday) and hour is 0-23
   */
  private buildCommitTimeHeatmap(timestamps: Date[]): number[][] {
    // Initialize 7x24 grid (7 days, 24 hours)
    const heatmap: number[][] = Array(7).fill(null).map(() => Array(24).fill(0));
    
    for (const timestamp of timestamps) {
      const dayOfWeek = timestamp.getDay(); // 0 = Sunday, 6 = Saturday
      const hour = timestamp.getHours(); // 0-23
      
      if (dayOfWeek >= 0 && dayOfWeek < 7 && hour >= 0 && hour < 24) {
        heatmap[dayOfWeek][hour]++;
      }
    }
    
    return heatmap;
  }

  private calculateBusFactor(contributors: any[]): number {
    if (contributors.length === 0) return 0;
    
    const totalCommits = contributors.reduce((sum, c) => sum + c.total_commits, 0);
    if (totalCommits === 0) return 0;
    
    // Calculate how many contributors are needed for 50% of commits
    const sortedContributors = contributors.sort((a, b) => b.total_commits - a.total_commits);
    let cumulativeCommits = 0;
    let contributorsNeeded = 0;
    
    for (const contributor of sortedContributors) {
      cumulativeCommits += contributor.total_commits;
      contributorsNeeded++;
      if (cumulativeCommits >= totalCommits * 0.5) break;
    }
    
    return contributorsNeeded;
  }
}
