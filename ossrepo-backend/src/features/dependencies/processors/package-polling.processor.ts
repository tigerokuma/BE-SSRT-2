import { Process, Processor } from '@nestjs/bull';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { GitManagerService } from '../../activity/services/git-manager.service';
import { GitCommitExtractorService, CommitDetails } from '../services/git-commit-extractor.service';
import { MonthlyCommitsService } from '../services/monthly-commits.service';
import { ContributorProfileUpdaterService } from '../services/contributor-profile-updater.service';
import { AnomalyDetectionService } from '../services/anomaly-detection.service';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import * as fs from 'fs';

interface PackagePollingJobData {
  type: 'daily-poll' | 'poll-package';
  packageId?: string;
  owner?: string;
  repo?: string;
  branch?: string;
}

interface PollPackageJobData {
  packageId: string;
  owner: string;
  repo: string;
  branch: string;
}

@Processor('package-polling')
export class PackagePollingProcessor implements OnModuleInit {
  private readonly logger = new Logger(PackagePollingProcessor.name);
  private isProcessingDailyPoll = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gitManager: GitManagerService,
    private readonly gitCommitExtractor: GitCommitExtractorService,
    private readonly monthlyCommits: MonthlyCommitsService,
    private readonly contributorUpdater: ContributorProfileUpdaterService,
    private readonly anomalyDetection: AnomalyDetectionService,
    @InjectQueue('package-polling') private readonly pollingQueue: Queue,
    @InjectQueue('dependency-full-setup') private readonly setupQueue: Queue,
  ) {}

  async onModuleInit() {
    await this.initializePollingSchedule();
  }

  async initializePollingSchedule() {
    try {
      const waitingJobs = await this.pollingQueue.getWaiting();
      const existingDailyPollJob = waitingJobs.find(
        (job) => job.name === 'daily-poll',
      );

      if (existingDailyPollJob) {
        this.logger.log('📅 Daily polling job already scheduled');
        return;
      }

      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);

      const delayMs = tomorrow.getTime() - now.getTime();

      await this.pollingQueue.add(
        'daily-poll',
        {},
        {
          delay: delayMs,
          attempts: 1,
          removeOnComplete: 10,
          removeOnFail: 50,
        },
      );

      this.logger.log(
        `📅 Scheduled daily package polling for ${tomorrow.toISOString()}`,
      );
    } catch (error) {
      this.logger.error('Error initializing polling schedule:', error);
    }
  }

  async triggerDailyPolling() {
    if (this.isProcessingDailyPoll) {
      this.logger.log('⏳ Daily polling already in progress, skipping...');
      return;
    }

    this.isProcessingDailyPoll = true;

    this.logger.log(
      `\n────────────────────────────────────────────────────────────\n🔍 DAILY PACKAGE POLLING TRIGGERED\n────────────────────────────────────────────────────────────`,
    );

    try {
      const activeSetupJobs = await this.setupQueue.getActive();
      if (activeSetupJobs.length > 0) {
        this.logger.log(
          `⏳ ${activeSetupJobs.length} setup jobs are running, skipping daily polling`,
        );
        return;
      }

      const packages = await this.prisma.packages.findMany({
        where: {
          status: 'done',
          repo_url: { not: null },
        },
        select: {
          id: true,
          name: true,
          repo_url: true,
          latest_commit_sha: true,
          default_branch: true,
        },
      });

      this.logger.log(
        `Found ${packages.length} packages ready for polling`,
      );

      let processedCount = 0;
      for (const pkg of packages) {
        if (!pkg.repo_url) continue;

        const urlParts = pkg.repo_url.replace(/\/$/, '').split('/');
        const repoName = urlParts.pop();
        const owner = urlParts.pop();

        if (!repoName || !owner) {
          this.logger.error(`Could not parse owner/repo from URL: ${pkg.repo_url}`);
          continue;
        }

        const branch = pkg.default_branch || 'main';

        try {
          await this.pollSinglePackage({
            packageId: pkg.id,
            owner,
            repo: repoName,
            branch,
          });
          processedCount++;

          // Add delay between packages to avoid rate limiting
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } catch (error) {
          this.logger.error(
            `Error polling package ${owner}/${repoName}:`,
            error,
          );
        }
      }

      this.logger.log(
        `✅ Completed polling for ${processedCount}/${packages.length} packages`,
      );
      await this.scheduleNextDailyPolling();
    } catch (error) {
      this.logger.error('Error during daily polling trigger:', error);
    } finally {
      this.isProcessingDailyPoll = false;
    }
  }

  private async scheduleNextDailyPolling(): Promise<void> {
    try {
      const waitingJobs = await this.pollingQueue.getWaiting();
      const existingDailyPollJob = waitingJobs.find(
        (job) => job.name === 'daily-poll',
      );

      if (existingDailyPollJob) {
        this.logger.log(
          '📅 Daily polling job already scheduled, skipping duplicate',
        );
        return;
      }

      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);

      const delayMs = tomorrow.getTime() - now.getTime();

      await this.pollingQueue.add(
        'daily-poll',
        {},
        {
          delay: delayMs,
          attempts: 1,
          removeOnComplete: 10,
          removeOnFail: 50,
        },
      );

      this.logger.log(
        `📅 Scheduled next daily polling for ${tomorrow.toISOString()}`,
      );
    } catch (error) {
      this.logger.error('Error scheduling next daily polling:', error);
    }
  }

  @Process('daily-poll')
  async handleDailyPoll(job: Job) {
    this.logger.log('🕛 Daily package polling job triggered');
    await this.triggerDailyPolling();
  }

  @Process('poll-package')
  async handlePollPackage(job: Job<PollPackageJobData>) {
    const { packageId, owner, repo, branch } = job.data;
    await this.pollSinglePackage({ packageId, owner, repo, branch });
  }

  private async pollSinglePackage(data: PollPackageJobData): Promise<void> {
    const { packageId, owner, repo, branch } = data;
    let repoPath: string | null = null;

    this.logger.log(
      `🔍 Polling package ${owner}/${repo} (package: ${packageId})`,
    );

    try {
      // Update last_polled_at
      await this.prisma.packages.update({
        where: { id: packageId },
        data: { last_polled_at: new Date() },
      });

      const latestRemoteSha = await this.getLatestRemoteCommitSha(
        owner,
        repo,
        branch,
      );

      if (!latestRemoteSha) {
        this.logger.warn(
          `Could not get latest commit SHA for ${owner}/${repo}`,
        );
        return;
      }

      const packageData = await this.prisma.packages.findUnique({
        where: { id: packageId },
        select: { latest_commit_sha: true },
      });

      const storedLatestSha = packageData?.latest_commit_sha;

      if (!storedLatestSha) {
        this.logger.log(
          `📝 No previous commit SHA stored for ${owner}/${repo}, storing current: ${latestRemoteSha}`,
        );
        await this.updateLatestCommitSha(packageId, latestRemoteSha);
        return;
      }

      if (latestRemoteSha === storedLatestSha) {
        this.logger.log(`✅ ${owner}/${repo}: No new commits found`);
        return;
      }

      this.logger.log(
        `🆕 ${owner}/${repo}: New commits found!\n` +
          `   Previous: ${storedLatestSha}\n` +
          `   Current:  ${latestRemoteSha}\n` +
          `   Beginning extraction process...`,
      );

      const cloneResult = await this.ensureRepositoryWithSha(
        owner,
        repo,
        branch,
        storedLatestSha,
      );

      if (!cloneResult) {
        this.logger.error(
          `Failed to clone repository ${owner}/${repo} with required depth for SHA ${storedLatestSha}`,
        );
        return;
      }

      repoPath = cloneResult;

      // Extract new commits
      const newCommits = await this.extractNewCommits(
        repoPath,
        storedLatestSha,
        latestRemoteSha,
      );

      if (newCommits.length === 0) {
        this.logger.log(`No new commits found in ${owner}/${repo}`);
        await this.updateLatestCommitSha(packageId, latestRemoteSha);
        return;
      }

      this.logger.log(
        `📊 Extracted ${newCommits.length} new commits from ${owner}/${repo}`,
      );

      // Store new commits
      await this.storeNewCommits(packageId, newCommits);

      // Update latest commit SHA immediately after storing commits
      // This ensures we don't reprocess the same commits if later steps fail
      await this.updateLatestCommitSha(packageId, latestRemoteSha);

      // Detect anomalies in new commits
      await this.detectAnomalies(packageId, newCommits);

      // Update contributor profiles
      await this.contributorUpdater.updateContributorProfiles(packageId, newCommits);

      // Update monthly commits
      await this.monthlyCommits.aggregateMonthlyCommits(packageId, newCommits);

      this.logger.log(
        `✅ Successfully processed ${newCommits.length} new commits for ${owner}/${repo}`,
      );
    } catch (error) {
      this.logger.error(`Error polling package ${owner}/${repo}:`, error);
    } finally {
      // Cleanup cloned repository
      if (repoPath && owner && repo) {
        await this.cleanupClonedRepo(owner, repo);
        this.logger.log(`🧹 Cleaned up repository: ${owner}/${repo}`);
      }
    }
  }

  /**
   * Get latest commit SHA from remote without cloning
   */
  private async getLatestRemoteCommitSha(
    owner: string,
    repo: string,
    branch: string,
  ): Promise<string | null> {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const repoUrl = `https://github.com/${owner}/${repo}.git`;
      const command = `git ls-remote ${repoUrl} refs/heads/${branch}`;
      const { stdout } = await execAsync(command);

      if (!stdout.trim()) {
        this.logger.warn(
          `No commits found for branch ${branch} in ${owner}/${repo}`,
        );
        return null;
      }

      const sha = stdout.trim().split('\t')[0];
      return sha;
    } catch (error) {
      this.logger.error(
        `Error getting latest remote commit SHA for ${owner}/${repo}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Ensure repository is cloned with the target SHA available
   */
  private async ensureRepositoryWithSha(
    owner: string,
    repo: string,
    branch: string,
    targetSha: string,
  ): Promise<string | null> {
    const cloneResult = await this.cloneWithSmartDepth(
      owner,
      repo,
      branch,
      targetSha,
    );

    if (cloneResult) {
      return cloneResult;
    }

    this.logger.log(`🔄 Trying shallow clone + deepen for ${owner}/${repo}`);
    try {
      const shallowRepoPath = await this.gitManager.cloneRepository(
        owner,
        repo,
        branch,
        1,
      );
      await this.gitManager.deepenRepository(owner, repo, branch, 2000);

      const shaExists = await this.checkShaExists(shallowRepoPath, targetSha);
      if (shaExists) {
        this.logger.log(`✅ Found target SHA ${targetSha} after deepening`);
        return shallowRepoPath;
      } else {
        this.logger.error(
          `❌ Target SHA ${targetSha} still not found after deepening`,
        );
        await this.cleanupClonedRepo(owner, repo);
        return null;
      }
    } catch (error) {
      this.logger.error(
        `❌ Failed to clone and deepen repository: ${error.message}`,
      );
      await this.cleanupClonedRepo(owner, repo);
      return null;
    }
  }

  /**
   * Clone repository with increasing depth until target SHA is found
   */
  private async cloneWithSmartDepth(
    owner: string,
    repo: string,
    branch: string,
    targetSha: string,
  ): Promise<string | null> {
    const depths = [5, 10, 20, 50, 100, 200, 500, 1000];
    const maxDepth = 2000;

    for (const depth of depths) {
      if (depth > maxDepth) {
        this.logger.error(
          `Failed to find target SHA ${targetSha} even with maximum depth ${maxDepth}`,
        );
        return null;
      }

      try {
        this.logger.log(`🔍 Trying clone depth ${depth} for ${owner}/${repo}`);

        const repoPath = await this.gitManager.cloneRepository(
          owner,
          repo,
          branch,
          depth,
        );
        const shaExists = await this.checkShaExists(repoPath, targetSha);

        if (shaExists) {
          this.logger.log(
            `✅ Found target SHA ${targetSha} with depth ${depth}`,
          );
          return repoPath;
        } else {
          this.logger.log(
            `❌ Target SHA ${targetSha} not found with depth ${depth}, trying deeper...`,
          );
          await this.cleanupClonedRepo(owner, repo);
        }
      } catch (cloneError) {
        this.logger.log(
          `❌ Clone failed with depth ${depth}, trying deeper...`,
        );
        await this.cleanupClonedRepo(owner, repo);
      }
    }

    return null;
  }

  /**
   * Check if SHA exists in repository
   */
  private async checkShaExists(
    repoPath: string,
    targetSha: string,
  ): Promise<boolean> {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    try {
      const revParseCommand = `cd "${repoPath}" && git rev-parse --verify ${targetSha}`;
      await execAsync(revParseCommand);
      return true;
    } catch (revParseError) {
      try {
        const logCommand = `cd "${repoPath}" && git log --oneline ${targetSha} -1`;
        await execAsync(logCommand);
        return true;
      } catch (logError) {
        try {
          const showCommand = `cd "${repoPath}" && git show ${targetSha} --format="%H" -s`;
          await execAsync(showCommand);
          return true;
        } catch (showError) {
          return false;
        }
      }
    }
  }

  /**
   * Extract new commits since a given SHA
   */
  private async extractNewCommits(
    repoPath: string,
    fromSha: string,
    toSha?: string,
  ): Promise<CommitDetails[]> {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      // Get commits after fromSha (up to toSha if provided)
      const range = toSha ? `${fromSha}..${toSha}` : `${fromSha}..HEAD`;
      const gitLogCmd = `git log --pretty=format:"%H|%an|%ae|%ad|%s" --numstat ${range}`;
      
      const { stdout, stderr } = await execAsync(
        `cd "${repoPath}" && ${gitLogCmd}`,
        {
          maxBuffer: 50 * 1024 * 1024, // 50MB buffer
        },
      );

      if (stderr && !stderr.includes('warning')) {
        this.logger.warn(`Git log stderr: ${stderr}`);
      }

      if (!stdout.trim()) {
        return [];
      }

      // Parse the commits using the existing GitCommitExtractorService logic
      const commits = this.parseGitLogOutput(stdout);
      
      // Extract diff data for each commit
      for (const commit of commits) {
        try {
          commit.diffData = await this.extractCommitDiff(repoPath, commit.sha);
        } catch (error) {
          this.logger.warn(`⚠️ Failed to extract diff for commit ${commit.sha}: ${error.message}`);
          commit.diffData = null;
        }
      }

      return commits;
    } catch (error) {
      this.logger.error(`Error extracting new commits: ${error.message}`);
      return [];
    }
  }

  /**
   * Parse git log output (copied from GitCommitExtractorService)
   */
  private parseGitLogOutput(output: string): CommitDetails[] {
    const commits: CommitDetails[] = [];
    const lines = output.trim().split('\n');
    
    let currentCommit: Partial<CommitDetails> | null = null;
    let currentStats: { added: number; deleted: number; files: number } = { added: 0, deleted: 0, files: 0 };

    for (const line of lines) {
      const trimmedLine = line.trim();
      
      if (!trimmedLine) continue;

      // Check if this is a commit header line (contains |)
      if (trimmedLine.includes('|')) {
        // Save previous commit if exists
        if (currentCommit && currentCommit.sha) {
          commits.push({
            ...currentCommit,
            linesAdded: currentStats.added,
            linesDeleted: currentStats.deleted,
            filesChanged: currentStats.files,
          } as CommitDetails);
        }

        // Parse new commit header
        const parts = trimmedLine.split('|');
        if (parts.length >= 5) {
          const [sha, author, authorEmail, dateStr, ...messageParts] = parts;
          const message = messageParts.join('|');

          currentCommit = {
            sha: sha.trim(),
            author: author.trim(),
            authorEmail: authorEmail.trim(),
            message: message.trim(),
            timestamp: new Date(dateStr.trim()),
          };

          // Reset stats for new commit
          currentStats = { added: 0, deleted: 0, files: 0 };
        }
      } else {
        // This is a file stat line (numstat format)
        const statParts = trimmedLine.split('\t');
        if (statParts.length >= 2) {
          const added = parseInt(statParts[0]) || 0;
          const deleted = parseInt(statParts[1]) || 0;
          const filename = statParts[2] || '';

          // Skip binary files and merge commits
          if (added !== 0 || deleted !== 0) {
            currentStats.added += added;
            currentStats.deleted += deleted;
            currentStats.files += 1;
          }
        }
      }
    }

    // Don't forget the last commit
    if (currentCommit && currentCommit.sha) {
      commits.push({
        ...currentCommit,
        linesAdded: currentStats.added,
        linesDeleted: currentStats.deleted,
        filesChanged: currentStats.files,
      } as CommitDetails);
    }

    return commits;
  }

  /**
   * Extract commit diff data (copied from GitCommitExtractorService)
   */
  private async extractCommitDiff(repoPath: string, commitSha: string): Promise<any> {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const { stdout } = await execAsync(
        `cd "${repoPath}" && git show --stat ${commitSha}`,
        {
          timeout: 30000,
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer per commit
        },
      );

      const lines = stdout.split('\n');
      const filesChanged: string[] = [];
      const diffStats = {
        filesChanged: 0,
        insertions: 0,
        deletions: 0,
        files: [] as Array<{ name: string; insertions: number; deletions: number }>
      };

      for (const line of lines) {
        const fileMatch = line.match(/^(.+?)\s+\|\s+(\d+)\s+([+-]+)$/);
        if (fileMatch) {
          const [, fileName, changes, symbols] = fileMatch;
          const insertions = (symbols.match(/\+/g) || []).length;
          const deletions = (symbols.match(/-/g) || []).length;
          
          filesChanged.push(fileName.trim());
          diffStats.files.push({
            name: fileName.trim(),
            insertions,
            deletions
          });
          diffStats.insertions += insertions;
          diffStats.deletions += deletions;
        }
      }

      diffStats.filesChanged = filesChanged.length;

      return {
        filesChanged,
        stats: diffStats,
        rawDiff: stdout.substring(0, 1000)
      };
    } catch (error) {
      this.logger.warn(`⚠️ Failed to extract diff for commit ${commitSha}: ${error.message}`);
      return null;
    }
  }

  /**
   * Store new commits in database
   */
  private async storeNewCommits(packageId: string, commits: CommitDetails[]): Promise<void> {
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

      await this.prisma.packageCommit.createMany({
        data: commitData,
        skipDuplicates: true
      });

      this.logger.log(`💾 Stored ${commits.length} new commits for package ${packageId}`);
    } catch (error) {
      this.logger.error(`❌ Failed to store new commits:`, error);
      throw error;
    }
  }

  /**
   * Update latest commit SHA in database
   */
  private async updateLatestCommitSha(packageId: string, sha: string): Promise<void> {
    try {
      await this.prisma.packages.update({
        where: { id: packageId },
        data: { latest_commit_sha: sha },
      });
      this.logger.log(`✅ Updated latest_commit_sha to ${sha.substring(0, 8)} for package ${packageId}`);
    } catch (error) {
      this.logger.error(`❌ Failed to update latest commit SHA for package ${packageId}:`, error);
      throw error;
    }
  }

  /**
   * Detect anomalies in new commits
   */
  private async detectAnomalies(packageId: string, commits: CommitDetails[]): Promise<void> {
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
          // First commit from this contributor - skip anomaly detection
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

          this.logger.log(
            `🚨 Anomaly detected in commit ${commit.sha.substring(0, 8)}: score ${result.totalScore} (${result.breakdown.length} factors)`,
          );
        }
      } catch (error) {
        this.logger.error(`Error detecting anomalies for commit ${commit.sha}:`, error);
        // Continue with other commits
      }
    }
  }

  /**
   * Cleanup cloned repository
   */
  private async cleanupClonedRepo(owner: string, repo: string): Promise<void> {
    try {
      await this.gitManager.cleanupRepository(owner, repo);
    } catch (error) {
      this.logger.error(`Failed to cleanup repository ${owner}/${repo}:`, error);
      // Don't throw - cleanup failure shouldn't fail the job
    }
  }
}
