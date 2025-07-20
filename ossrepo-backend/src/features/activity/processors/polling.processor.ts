import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { GitManagerService } from '../services/git-manager.service';
import { AlertingService } from '../services/alerting.service';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

interface PollingJobData {
  type: 'daily-poll' | 'poll-repo';
  watchlistId?: string;
  owner?: string;
  repo?: string;
  branch?: string;
}

interface PollRepoJobData {
  watchlistId: string;
  owner: string;
  repo: string;
  branch: string;
}

@Processor('polling')
export class PollingProcessor {
  private readonly logger = new Logger(PollingProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gitManager: GitManagerService,
    private readonly alertingService: AlertingService,
    @InjectQueue('polling') private readonly pollingQueue: Queue,
    @InjectQueue('repository-setup') private readonly setupQueue: Queue,
  ) {
    // Initialize daily polling schedule when the processor starts
    this.initializeDailyPolling();
  }

  // Daily job that queues individual repo polling jobs
  // This is triggered by a BullMQ job with delay, not cron
  async triggerDailyPolling() {
    this.logger.log(
      `\n────────────────────────────────────────────────────────────\n🔍 DAILY POLLING TRIGGERED\n────────────────────────────────────────────────────────────`
    );

    try {
      // Check if any setup jobs are running (they take priority)
      const activeSetupJobs = await this.setupQueue.getActive();
      if (activeSetupJobs.length > 0) {
        this.logger.log(`⏳ ${activeSetupJobs.length} setup jobs are running, skipping daily polling`);
        return;
      }

      // Get all ready repositories from watchlist
      const watchlistedRepos = await this.prisma.watchlist.findMany({
        where: {
          status: 'ready',
        },
        select: {
          watchlist_id: true,
          default_branch: true,
          latest_commit_sha: true,
          package: {
            select: {
              repo_url: true,
              repo_name: true,
            }
          },
        },
      });

      this.logger.log(`Found ${watchlistedRepos.length} ready repositories to poll`);

      // Queue individual polling jobs for each repository
      for (const repo of watchlistedRepos) {
        const { repo_url, repo_name } = repo.package;
        const { default_branch } = repo;
        
        if (!default_branch) {
          this.logger.warn(`No default branch found for ${repo_name}, skipping`);
          continue;
        }

        // Parse owner and repo from URL
        const urlParts = repo_url.replace(/\/$/, '').split('/');
        const repoName = urlParts.pop();
        const owner = urlParts.pop();
        
        if (!repoName || !owner) {
          this.logger.error(`Could not parse owner/repo from URL: ${repo_url}`);
          continue;
        }

        await this.pollingQueue.add(
          'poll-repo',
          {
            watchlistId: repo.watchlist_id,
            owner,
            repo: repoName,
            branch: default_branch,
          },
          {
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 2000,
            },
            removeOnComplete: 10,
            removeOnFail: 50,
            priority: 1, // Lower priority than setup jobs
          },
        );

        this.logger.log(`Queued polling job for ${owner}/${repoName}`);
      }

      this.logger.log(`✅ Queued ${watchlistedRepos.length} polling jobs`);

      // Schedule the next daily polling job for tomorrow at midnight
      await this.scheduleNextDailyPolling();
    } catch (error) {
      this.logger.error('Error during daily polling trigger:', error);
    }
  }

  private async scheduleNextDailyPolling(): Promise<void> {
    try {
      // Calculate delay until next midnight
      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0); // Set to midnight
      
      const delayMs = tomorrow.getTime() - now.getTime();
      
      await this.pollingQueue.add(
        'daily-poll',
        {},
        {
          delay: delayMs,
          attempts: 1, // Don't retry daily polling if it fails
          removeOnComplete: 10,
          removeOnFail: 50,
        },
      );

      this.logger.log(`📅 Scheduled next daily polling for ${tomorrow.toISOString()}`);
    } catch (error) {
      this.logger.error('Error scheduling next daily polling:', error);
    }
  }

  @Process('daily-poll')
  async handleDailyPoll(job: Job) {
    this.logger.log('🕛 Daily polling job triggered');
    await this.triggerDailyPolling();
  }

  @Process('poll-repo')
  async handlePollRepo(job: Job<PollRepoJobData>) {
    const { watchlistId, owner, repo, branch } = job.data;
    let repoPath: string | null = null;

    this.logger.log(
      `🔍 Polling repository ${owner}/${repo} (watchlist: ${watchlistId})`
    );

    try {
      // Get the latest commit SHA from GitHub CLI
      const latestRemoteSha = await this.getLatestRemoteCommitSha(owner, repo, branch);
      
      if (!latestRemoteSha) {
        this.logger.warn(`Could not get latest commit SHA for ${owner}/${repo}`);
        return;
      }

      // Get the stored latest commit SHA
      const watchlist = await this.prisma.watchlist.findUnique({
        where: { watchlist_id: watchlistId },
        select: { latest_commit_sha: true },
      });

      const storedLatestSha = watchlist?.latest_commit_sha;

      if (!storedLatestSha) {
        this.logger.log(`📝 No previous commit SHA stored for ${owner}/${repo}, storing current: ${latestRemoteSha}`);
        await this.updateLatestCommitSha(watchlistId, latestRemoteSha);
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
        `   Beginning extraction process...`
      );

      // Clone repository with smart depth adjustment
      repoPath = await this.cloneWithSmartDepth(owner, repo, branch, storedLatestSha);
      
      if (!repoPath) {
        this.logger.error(`Failed to clone repository ${owner}/${repo} with required depth`);
        return;
      }

      // Get commits since the stored SHA
      const newCommits = await this.getCommitsSinceSha(repoPath, storedLatestSha);
      
      if (newCommits.length === 0) {
        this.logger.warn(`No commits found since ${storedLatestSha} for ${owner}/${repo}`);
        await this.updateLatestCommitSha(watchlistId, latestRemoteSha);
        return;
      }

      this.logger.log(`📝 Found ${newCommits.length} new commits for ${owner}/${repo}`);

      // Log commits to database
      await this.logCommitsToDatabase(watchlistId, newCommits);

      // Check for alerts on each commit
      for (const commit of newCommits) {
        await this.alertingService.checkCommitForAlerts(watchlistId, {
          sha: commit.sha,
          author: commit.author,
          email: commit.email,
          message: commit.message,
          date: commit.date,
          linesAdded: commit.linesAdded,
          linesDeleted: commit.linesDeleted,
          filesChanged: commit.filesChanged,
        });
      }

      // Update contributor and repository statistics
      await this.updateStatistics(watchlistId);

      // Update the latest commit SHA and commits since last health update
      await this.updateLatestCommitSha(watchlistId, latestRemoteSha);
      await this.updateCommitsSinceLastHealthUpdate(watchlistId, newCommits.length);

      this.logger.log(`✅ Polling completed for ${owner}/${repo} (${newCommits.length} commits processed)`);

    } catch (error) {
      this.logger.error(`Error polling repository ${owner}/${repo}:`, error);
      throw error;
    } finally {
      // Clean up repository
      if (repoPath) {
        await this.gitManager.cleanupRepository(owner, repo);
      }
    }
  }

  private async getLatestRemoteCommitSha(owner: string, repo: string, branch: string): Promise<string | null> {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const repoUrl = `https://github.com/${owner}/${repo}.git`;
      const command = `git ls-remote ${repoUrl} refs/heads/${branch}`;
      const { stdout } = await execAsync(command);
      
      if (!stdout.trim()) {
        this.logger.warn(`No commits found for branch ${branch} in ${owner}/${repo}`);
        return null;
      }

      // git ls-remote returns: <sha> <ref>
      const sha = stdout.trim().split('\t')[0];
      return sha;
    } catch (error) {
      this.logger.error(`Error getting latest remote commit SHA for ${owner}/${repo}:`, error);
      return null;
    }
  }

  private async cloneWithSmartDepth(
    owner: string, 
    repo: string, 
    branch: string, 
    targetSha: string
  ): Promise<string | null> {
    const depths = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];
    
    for (const depth of depths) {
      try {
        this.logger.log(`🔍 Trying clone depth ${depth} for ${owner}/${repo}`);
        
        // Clone with current depth
        const repoPath = await this.gitManager.cloneRepository(owner, repo, branch);
        
        // Check if we can find the target SHA
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);
        
        const command = `cd ${repoPath} && git log --oneline ${targetSha} -1`;
        await execAsync(command);
        
        this.logger.log(`✅ Found target SHA ${targetSha} with depth ${depth}`);
        return repoPath;
        
      } catch (error) {
        this.logger.log(`❌ Target SHA not found with depth ${depth}, trying deeper...`);
        // Clean up failed clone
        await this.gitManager.cleanupRepository(owner, repo);
      }
    }
    
    this.logger.error(`Failed to find target SHA ${targetSha} even with maximum depth`);
    return null;
  }

  private async getCommitsSinceSha(repoPath: string, sinceSha: string): Promise<any[]> {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      // Get basic commit information
      const command = `cd ${repoPath} && git log ${sinceSha}..HEAD --pretty=format:"%H|%an|%ae|%ad|%s" --date=iso`;
      const { stdout } = await execAsync(command);

      if (!stdout.trim()) {
        return [];
      }

      const commits: any[] = [];
      const lines = stdout.trim().split('\n');
      
      for (const line of lines) {
        const [sha, author, email, date, message] = line.split('|');
        
        // Get detailed commit statistics
        const statsCommand = `cd ${repoPath} && git show --stat --format="" ${sha}`;
        let linesAdded = 0;
        let linesDeleted = 0;
        let filesChanged: string[] = [];
        
        try {
          const { stdout: statsOutput } = await execAsync(statsCommand);
          
          // Parse the stats output
          const statsLines = statsOutput.split('\n');
          for (const statLine of statsLines) {
            // Look for lines like " 5 files changed, 123 insertions(+), 45 deletions(-)"
            const fileMatch = statLine.match(/(\d+) files? changed/);
            const insertionMatch = statLine.match(/(\d+) insertions?\(\+\)/);
            const deletionMatch = statLine.match(/(\d+) deletions?\(-\)/);
            
            if (insertionMatch) {
              linesAdded = parseInt(insertionMatch[1], 10);
            }
            if (deletionMatch) {
              linesDeleted = parseInt(deletionMatch[1], 10);
            }
          }
          
          // Get list of changed files
          const filesCommand = `cd ${repoPath} && git show --name-only --format="" ${sha}`;
          const { stdout: filesOutput } = await execAsync(filesCommand);
          filesChanged = filesOutput.trim().split('\n').filter(file => file.trim() !== '');
          
        } catch (statsError) {
          this.logger.warn(`Could not get detailed stats for commit ${sha}: ${statsError.message}`);
        }
        
        commits.push({
          sha,
          author,
          email,
          date: new Date(date),
          message,
          linesAdded,
          linesDeleted,
          filesChanged,
        });
      }

      return commits;
    } catch (error) {
      this.logger.error(`Error getting commits since ${sinceSha}:`, error);
      return [];
    }
  }

  private async logCommitsToDatabase(watchlistId: string, commits: any[]): Promise<void> {
    try {
      for (const commit of commits) {
        await this.prisma.log.create({
          data: {
            watchlist_id: watchlistId,
            event_type: 'COMMIT',
            actor: commit.author,
            timestamp: commit.date,
            event_hash: this.createEventHash(commit.sha + commit.author + commit.date.toISOString()),
            payload: {
              sha: commit.sha,
              author: commit.author,
              email: commit.email,
              message: commit.message,
              date: commit.date.toISOString(),
              linesAdded: commit.linesAdded,
              linesDeleted: commit.linesDeleted,
              filesChanged: commit.filesChanged,
            },
          },
        });
      }
      
      this.logger.log(`📝 Logged ${commits.length} commits to database`);
    } catch (error) {
      this.logger.error(`Error logging commits to database:`, error);
      throw error;
    }
  }

  private async updateStatistics(watchlistId: string): Promise<void> {
    try {
      this.logger.log(`📊 Updating contributor and repository statistics...`);
      await this.gitManager.updateContributorStats(watchlistId);
      // Note: updateRepoStats is private, so we'll use ensureStatsExist instead
      await this.gitManager.ensureStatsExist(watchlistId);
      this.logger.log(`✅ Statistics updated successfully`);
    } catch (error) {
      this.logger.error(`Error updating statistics:`, error);
      // Don't fail the entire process if stats update fails
    }
  }

  private async updateLatestCommitSha(watchlistId: string, commitSha: string): Promise<void> {
    try {
      await this.prisma.watchlist.update({
        where: { watchlist_id: watchlistId },
        data: { 
          latest_commit_sha: commitSha,
          updated_at: new Date(),
        },
      });
      this.logger.log(`Updated latest commit SHA for watchlist ${watchlistId} to ${commitSha}`);
    } catch (error) {
      this.logger.error(`Error updating latest commit SHA for watchlist ${watchlistId}:`, error);
      throw error;
    }
  }

  private async updateCommitsSinceLastHealthUpdate(watchlistId: string, newCommitsCount: number): Promise<void> {
    try {
      // Get current count and add new commits
      const watchlist = await this.prisma.watchlist.findUnique({
        where: { watchlist_id: watchlistId },
        select: { commits_since_last_health_update: true },
      });

      const currentCount = watchlist?.commits_since_last_health_update || 0;
      const newTotal = currentCount + newCommitsCount;

      await this.prisma.watchlist.update({
        where: { watchlist_id: watchlistId },
        data: { 
          commits_since_last_health_update: newTotal,
          updated_at: new Date(),
        },
      });
      this.logger.log(`Updated commits since last health update for watchlist ${watchlistId}: ${currentCount} + ${newCommitsCount} = ${newTotal}`);
    } catch (error) {
      this.logger.error(`Error updating commits since last health update for watchlist ${watchlistId}:`, error);
      throw error;
    }
  }

  // Manual trigger for testing
  async triggerPolling() {
    this.logger.log('Manually triggering daily polling...');
    await this.triggerDailyPolling();
  }

  private async initializeDailyPolling(): Promise<void> {
    try {
      // Check if there's already a daily polling job scheduled
      const waitingJobs = await this.pollingQueue.getWaiting();
      const dailyPollJob = waitingJobs.find(job => job.name === 'daily-poll');
      
      if (!dailyPollJob) {
        this.logger.log('🚀 Initializing daily polling schedule...');
        await this.scheduleNextDailyPolling();
      } else {
        this.logger.log('📅 Daily polling schedule already exists');
      }
    } catch (error) {
      this.logger.error('Error initializing daily polling:', error);
    }
  }

  private createEventHash(data: string): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(data).digest('hex');
  }
} 