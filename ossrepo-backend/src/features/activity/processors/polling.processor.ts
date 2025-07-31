import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { GitManagerService } from '../services/git-manager.service';
import { AlertingService } from '../services/alerting.service';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import * as fs from 'fs';

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
  private isProcessingDailyPoll = false; // Prevent concurrent daily polling

  constructor(
    private readonly prisma: PrismaService,
    private readonly gitManager: GitManagerService,
    private readonly alertingService: AlertingService,
    @InjectQueue('polling') private readonly pollingQueue: Queue,
    @InjectQueue('repository-setup') private readonly setupQueue: Queue,
  ) {
    // Removed automatic daily polling initialization to prevent duplicate jobs on server restart
    // Daily polling should be manually triggered or scheduled externally
  }

  // Daily job that processes repositories sequentially
  async triggerDailyPolling() {
    // Prevent concurrent daily polling
    if (this.isProcessingDailyPoll) {
      this.logger.log('⏳ Daily polling already in progress, skipping...');
      return;
    }

    this.isProcessingDailyPoll = true;

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

      // Process repositories sequentially instead of queuing individual jobs
      let processedCount = 0;
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

        try {
          await this.pollSingleRepository({
            watchlistId: repo.watchlist_id,
            owner,
            repo: repoName,
            branch: default_branch,
          });
          processedCount++;
          
          // Small delay between repositories to make sequential processing obvious
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          this.logger.error(`Error polling repository ${owner}/${repoName}:`, error);
          // Continue with next repository instead of failing entire process
        }
      }

      this.logger.log(`✅ Completed polling for ${processedCount}/${watchlistedRepos.length} repositories`);

      // Schedule the next daily polling job for tomorrow at midnight
      await this.scheduleNextDailyPolling();
    } catch (error) {
      this.logger.error('Error during daily polling trigger:', error);
    } finally {
      this.isProcessingDailyPoll = false;
    }
  }

  private async scheduleNextDailyPolling(): Promise<void> {
    try {
      // Check if there's already a daily polling job scheduled
      const waitingJobs = await this.pollingQueue.getWaiting();
      const existingDailyPollJob = waitingJobs.find(job => job.name === 'daily-poll');
      
      if (existingDailyPollJob) {
        this.logger.log('📅 Daily polling job already scheduled, skipping duplicate');
        return;
      }

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
    // This method is kept for backward compatibility but should not be used
    // All polling should go through the daily polling process
    this.logger.warn('Individual poll-repo jobs are deprecated. Use daily polling instead.');
    const { watchlistId, owner, repo, branch } = job.data;
    await this.pollSingleRepository({ watchlistId, owner, repo, branch });
  }

  private async pollSingleRepository(data: PollRepoJobData): Promise<void> {
    const { watchlistId, owner, repo, branch } = data;
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

      // Clone repository with smart depth adjustment and fallback deepening
      repoPath = await this.ensureRepositoryWithSha(owner, repo, branch, storedLatestSha);
      
      if (!repoPath) {
        this.logger.error(`Failed to clone repository ${owner}/${repo} with required depth for SHA ${storedLatestSha}`);
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
    // Use the same approach as repository setup - clone with --no-checkout to avoid Windows filename issues
    const depths = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];
    const maxDepth = 1000; // Increased from 100 to allow deeper history
    
    for (const depth of depths) {
      if (depth > maxDepth) {
        this.logger.error(`Failed to find target SHA ${targetSha} even with maximum depth ${maxDepth}`);
        return null;
      }

      try {
        this.logger.log(`🔍 Trying clone depth ${depth} for ${owner}/${repo}`);
        
        // Clone with current depth
        const repoPath = await this.gitManager.cloneRepository(owner, repo, branch, depth);
        
        // Check if SHA exists in the repository
        const shaExists = await this.checkShaExists(repoPath, targetSha);
        
        if (shaExists) {
          this.logger.log(`✅ Found target SHA ${targetSha} with depth ${depth}`);
          return repoPath;
        } else {
          this.logger.log(`❌ Target SHA ${targetSha} not found with depth ${depth}, trying deeper...`);
          // Clean up this clone and try deeper
          await this.gitManager.cleanupRepository(owner, repo);
        }
        
      } catch (cloneError) {
        this.logger.log(`❌ Clone failed with depth ${depth}, trying deeper...`);
        // Clean up failed clone
        await this.gitManager.cleanupRepository(owner, repo);
      }
    }
    
    // If iterative deepening failed, try the git manager's deepenRepository method as fallback
    this.logger.log(`🔄 Iterative deepening failed, trying git manager's deepenRepository method...`);
    try {
      const repoPath = await this.gitManager.cloneRepository(owner, repo, branch, 1);
      await this.gitManager.deepenRepository(owner, repo, branch, 2000);
      
      // Check if SHA exists after deepening
      const shaExists = await this.checkShaExists(repoPath, targetSha);
      if (shaExists) {
        this.logger.log(`✅ Found target SHA ${targetSha} after deepening repository`);
        return repoPath;
      } else {
        this.logger.error(`❌ Target SHA ${targetSha} still not found after deepening`);
        await this.gitManager.cleanupRepository(owner, repo);
        return null;
      }
    } catch (deepenError) {
      this.logger.error(`❌ Failed to deepen repository: ${deepenError.message}`);
      await this.gitManager.cleanupRepository(owner, repo);
      return null;
    }
  }

  private async checkShaExists(repoPath: string, targetSha: string): Promise<boolean> {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    
    try {
      // First try: git rev-parse (most reliable)
      const revParseCommand = `cd "${repoPath}" && git rev-parse --verify ${targetSha}`;
      await execAsync(revParseCommand);
      return true;
    } catch (revParseError) {
      try {
        // Second try: git log (more flexible)
        const logCommand = `cd "${repoPath}" && git log --oneline ${targetSha} -1`;
        await execAsync(logCommand);
        return true;
      } catch (logError) {
        try {
          // Third try: git show (most permissive)
          const showCommand = `cd "${repoPath}" && git show ${targetSha} --format="%H" -s`;
          await execAsync(showCommand);
          return true;
        } catch (showError) {
          // SHA not found with this depth
          return false;
        }
      }
    }
  }

  private async ensureRepositoryWithSha(
    owner: string, 
    repo: string, 
    branch: string, 
    targetSha: string
  ): Promise<string | null> {
    // First try to clone with smart depth
    const repoPath = await this.cloneWithSmartDepth(owner, repo, branch, targetSha);
    
    if (repoPath) {
      return repoPath;
    }
    
    // If that fails, try to clone shallow and then deepen
    this.logger.log(`🔄 Trying shallow clone + deepen for ${owner}/${repo}`);
    try {
      const shallowRepoPath = await this.gitManager.cloneRepository(owner, repo, branch, 1);
      
      // Try to deepen the repository
      await this.gitManager.deepenRepository(owner, repo, branch, 2000);
      
      // Check if SHA exists after deepening
      const shaExists = await this.checkShaExists(shallowRepoPath, targetSha);
      if (shaExists) {
        this.logger.log(`✅ Found target SHA ${targetSha} after deepening`);
        return shallowRepoPath;
      } else {
        this.logger.error(`❌ Target SHA ${targetSha} still not found after deepening`);
        await this.gitManager.cleanupRepository(owner, repo);
        return null;
      }
    } catch (error) {
      this.logger.error(`❌ Failed to clone and deepen repository: ${error.message}`);
      await this.gitManager.cleanupRepository(owner, repo);
      return null;
    }
  }

  private async logRepositoryState(repoPath: string, targetSha: string): Promise<void> {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      
      // Get repository info
      const { stdout: logOutput } = await execAsync(`cd "${repoPath}" && git log --oneline -10`);
      const { stdout: revListOutput } = await execAsync(`cd "${repoPath}" && git rev-list --count HEAD`);
      
      this.logger.log(`📊 Repository state for ${targetSha}:`);
      this.logger.log(`   Total commits: ${revListOutput.trim()}`);
      this.logger.log(`   Recent commits: ${logOutput.split('\n').slice(0, 3).join(', ')}`);
    } catch (error) {
      this.logger.warn(`Could not log repository state: ${error.message}`);
    }
  }

  private async cloneWithNoCheckout(
    owner: string,
    repo: string,
    branch: string,
    depth: number
  ): Promise<string> {
    // Use the same path logic as GitManagerService
    const baseDir = this.gitManager['baseDir'];
    const combinedName = `${owner}-${repo}`;
    const maxPathLength = 200;
    
    let repoPath: string;
    if (combinedName.length > maxPathLength) {
      const maxRepoLength = maxPathLength - owner.length - 1;
      const truncatedRepo = repo.substring(0, maxRepoLength);
      repoPath = `${baseDir}/${owner}-${truncatedRepo}`;
    } else {
      repoPath = `${baseDir}/${combinedName}`;
    }
    
    const repoUrl = `https://github.com/${owner}/${repo}.git`;

    try {
      // Clean up any existing repository first
      if (fs.existsSync(repoPath)) {
        await this.gitManager.cleanupRepository(owner, repo);
      }

      // Clone the repository with --no-checkout to avoid Windows filename issues
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const { stdout, stderr } = await execAsync(
        `git clone --branch ${branch} --single-branch --depth ${depth} --no-checkout --no-tags ${repoUrl} "${repoPath}"`,
        { timeout: 300000 }, // 5 minute timeout
      );

      if (stderr && !stderr.includes('Cloning into')) {
        this.logger.warn(`Git clone stderr: ${stderr}`);
      }

      return repoPath;
    } catch (error) {
      this.logger.error(`Error cloning repository ${owner}/${repo} with depth ${depth}:`, error);

      // Clean up partial clone if it exists
      if (fs.existsSync(repoPath)) {
        await this.gitManager.cleanupRepository(owner, repo);
      }

      throw new Error(
        `Failed to clone repository ${owner}/${repo} with depth ${depth}: ${error.message}`,
      );
    }
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