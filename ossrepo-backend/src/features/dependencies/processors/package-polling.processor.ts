import { Process, Processor } from '@nestjs/bull';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { GitManagerService } from '../../activity/services/git-manager.service';
import { GitCommitExtractorService, CommitDetails } from '../services/git-commit-extractor.service';
import { MonthlyCommitsService } from '../services/monthly-commits.service';
import { ContributorProfileUpdaterService } from '../services/contributor-profile-updater.service';
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
          `Failed to clone repository ${owner}/${repo} with SHA ${storedLatestSha}`,
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

      // Update contributor profiles
      await this.contributorUpdater.updateContributorProfiles(packageId, newCommits);

      // Update monthly commits
      await this.monthlyCommits.aggregateMonthlyCommits(packageId, newCommits);

      // Update latest commit SHA
      await this.updateLatestCommitSha(packageId, latestRemoteSha);

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
   * Get latest commit SHA from GitHub API
   */
  private async getLatestRemoteCommitSha(
    owner: string,
    repo: string,
    branch: string,
  ): Promise<string | null> {
    try {
      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/commits/${branch}`,
        {
          headers: {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'OSSRepo-Backend',
          },
        },
      );

      if (!response.ok) {
        this.logger.warn(
          `GitHub API error for ${owner}/${repo}: ${response.status}`,
        );
        return null;
      }

      const data = await response.json();
      return data.sha;
    } catch (error) {
      this.logger.error(
        `Error fetching latest commit SHA for ${owner}/${repo}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Ensure repository is cloned with the specified SHA
   */
  private async ensureRepositoryWithSha(
    owner: string,
    repo: string,
    branch: string,
    targetSha: string,
  ): Promise<string | null> {
    try {
      // Try to clone with increasing depth until we find the target SHA
      const depths = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];
      
      for (const depth of depths) {
        try {
          const repoPath = await this.gitManager.cloneRepository(
            owner,
            repo,
            branch,
            depth,
          );

          // Check if the target SHA exists in this clone
          const { exec } = require('child_process');
          const { promisify } = require('util');
          const execAsync = promisify(exec);

          const { stdout } = await execAsync(
            `git rev-parse --verify ${targetSha}`,
            { cwd: repoPath },
          );

          if (stdout.trim() === targetSha) {
            this.logger.log(
              `✅ Found target SHA ${targetSha} with depth ${depth}`,
            );
            return repoPath;
          }
        } catch (error) {
          // Continue to next depth
          continue;
        }
      }

      this.logger.error(
        `Could not find target SHA ${targetSha} even with max depth`,
      );
      return null;
    } catch (error) {
      this.logger.error(
        `Error ensuring repository clone for ${owner}/${repo}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Extract new commits between two SHAs
   */
  private async extractNewCommits(
    repoPath: string,
    fromSha: string,
    toSha: string,
  ): Promise<CommitDetails[]> {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      // Get commits between the two SHAs
      const { stdout } = await execAsync(
        `git log --pretty=format:"%H|%an|%ae|%ad|%s" --numstat ${fromSha}..${toSha}`,
        { cwd: repoPath },
      );

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
      this.logger.error('Error extracting new commits:', error);
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

      const { stdout } = await execAsync(`git show --stat ${commitSha}`, {
        cwd: repoPath,
        timeout: 30000,
      });

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
    } catch (error) {
      this.logger.error(`❌ Failed to update latest commit SHA:`, error);
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
      this.logger.error(`Failed to cleanup repository ${owner}/${repo}:`, error);
      // Don't throw - cleanup failure shouldn't fail the job
    }
  }
}
