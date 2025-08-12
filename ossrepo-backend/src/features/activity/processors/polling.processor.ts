import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { GitManagerService } from '../services/git-manager.service';
import { AlertingService } from '../services/alerting.service';
import { ActivityAnalysisService } from '../services/activity-analysis.service';
import { BusFactorService } from '../services/bus-factor.service';
import { AIAnomalyDetectionService } from '../services/ai-anomaly-detection.service';
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
  private isProcessingDailyPoll = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gitManager: GitManagerService,
    private readonly alertingService: AlertingService,
    private readonly activityAnalysisService: ActivityAnalysisService,
    private readonly busFactorService: BusFactorService,
    private readonly aiAnomalyDetectionService: AIAnomalyDetectionService,
    @InjectQueue('polling') private readonly pollingQueue: Queue,
    @InjectQueue('repository-setup') private readonly setupQueue: Queue,
  ) {}

  async triggerDailyPolling() {
    if (this.isProcessingDailyPoll) {
      this.logger.log('⏳ Daily polling already in progress, skipping...');
      return;
    }

    this.isProcessingDailyPoll = true;

    this.logger.log(
      `\n────────────────────────────────────────────────────────────\n🔍 DAILY POLLING TRIGGERED\n────────────────────────────────────────────────────────────`
    );

    try {
      const activeSetupJobs = await this.setupQueue.getActive();
      if (activeSetupJobs.length > 0) {
        this.logger.log(`⏳ ${activeSetupJobs.length} setup jobs are running, skipping daily polling`);
        return;
      }

      const watchlistedRepos = await this.prisma.watchlist.findMany({
        where: { status: 'ready' },
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

      let processedCount = 0;
      for (const repo of watchlistedRepos) {
        const { repo_url, repo_name } = repo.package;
        const { default_branch } = repo;
        
        if (!default_branch) {
          this.logger.warn(`No default branch found for ${repo_name}, skipping`);
          continue;
        }

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
          
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          this.logger.error(`Error polling repository ${owner}/${repoName}:`, error);
        }
      }

      this.logger.log(`✅ Completed polling for ${processedCount}/${watchlistedRepos.length} repositories`);
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
      const existingDailyPollJob = waitingJobs.find(job => job.name === 'daily-poll');
      
      if (existingDailyPollJob) {
        this.logger.log('📅 Daily polling job already scheduled, skipping duplicate');
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
    this.logger.warn('Individual poll-repo jobs are deprecated. Use daily polling instead.');
    const { watchlistId, owner, repo, branch } = job.data;
    await this.pollSingleRepository({ watchlistId, owner, repo, branch });
  }

  private async pollSingleRepository(data: PollRepoJobData): Promise<void> {
    const { watchlistId, owner, repo, branch } = data;
    let repoPath: string | null = null;

    this.logger.log(`🔍 Polling repository ${owner}/${repo} (watchlist: ${watchlistId})`);

    try {
      const latestRemoteSha = await this.getLatestRemoteCommitSha(owner, repo, branch);
      
      if (!latestRemoteSha) {
        this.logger.warn(`Could not get latest commit SHA for ${owner}/${repo}`);
        return;
      }

      const watchlist = await this.prisma.watchlist.findUnique({
        where: { watchlist_id: watchlistId },
        select: { latest_commit_sha: true },
      });

      const storedLatestSha = watchlist?.latest_commit_sha;

      if (!storedLatestSha) {
        this.logger.log(`📝 No previous commit SHA stored for ${owner}/${repo}, storing current: ${latestRemoteSha}`);
        await this.updateLatestCommitSha(watchlistId, latestRemoteSha);
        await this.updateActivityScore(watchlistId);
        this.logger.log(`✅ Activity score update completed for ${watchlistId}`);
        return;
      }

      if (latestRemoteSha === storedLatestSha) {
        this.logger.log(`✅ ${owner}/${repo}: No new commits found`);
        await this.updateActivityScore(watchlistId);
        this.logger.log(`✅ Activity score update completed for ${watchlistId}`);
        return;
      }

      this.logger.log(
        `🆕 ${owner}/${repo}: New commits found!\n` +
        `   Previous: ${storedLatestSha}\n` +
        `   Current:  ${latestRemoteSha}\n` +
        `   Beginning extraction process...`
      );

      const cloneResult = await this.ensureRepositoryWithSha(owner, repo, branch, storedLatestSha);
      
      if (!cloneResult) {
        this.logger.error(`Failed to clone repository ${owner}/${repo} with required depth for SHA ${storedLatestSha}`);
        return;
      }

      repoPath = cloneResult.repoPath;
      const cloneDepth = cloneResult.depth;

      const newCommits = await this.getCommitsSinceSha(repoPath, storedLatestSha, cloneDepth);
      
      if (newCommits.length === 0) {
        this.logger.warn(`No commits found since ${storedLatestSha} for ${owner}/${repo}`);
        await this.updateLatestCommitSha(watchlistId, latestRemoteSha);
        this.logger.log(`✅ Polling completed for ${owner}/${repo} (no new commits)`);
        return;
      }

      this.logger.log(`📝 Found ${newCommits.length} new commits for ${owner}/${repo}`);
      
      newCommits.forEach((commit, index) => {
        this.logger.log(`  Commit ${index + 1}: ${commit.sha.substring(0, 8)} by ${commit.author}`);
        this.logger.log(`    Files: ${commit.filesChanged.length}, Lines: +${commit.linesAdded} -${commit.linesDeleted}`);
        this.logger.log(`    Message: ${commit.message.substring(0, 100)}...`);
      });

      await this.logCommitsToDatabase(watchlistId, newCommits);

      const commitsForAI = newCommits.map(commit => ({
        actor: commit.author,
        timestamp: commit.date,
        payload: {
          sha: commit.sha,
          author: commit.author,
          email: commit.email,
          message: commit.message,
          date: commit.date.toISOString(),
          lines_added: commit.linesAdded,
          lines_deleted: commit.linesDeleted,
          files_changed: commit.filesChanged,
        }
      }));
      await this.checkNewCommitsForAnomalies(watchlistId, commitsForAI);

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

      await this.updateStatistics(watchlistId);

      this.logger.log(`🔄 About to update activity score for ${watchlistId}`);
      await this.updateActivityScore(watchlistId);
      this.logger.log(`✅ Activity score update completed for ${watchlistId}`);

      await this.updateLatestCommitSha(watchlistId, latestRemoteSha);
      await this.updateCommitsSinceLastHealthUpdate(watchlistId, newCommits.length);

      this.logger.log(`✅ Polling completed for ${owner}/${repo} (${newCommits.length} commits processed)`);

    } catch (error) {
      this.logger.error(`Error polling repository ${owner}/${repo}:`, error);
      throw error;
    } finally {
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
  ): Promise<{ repoPath: string; depth: number } | null> {
    const depths = [5, 10, 20, 50, 100, 200, 500, 1000];
    const maxDepth = 2000;
    
    for (const depth of depths) {
      if (depth > maxDepth) {
        this.logger.error(`Failed to find target SHA ${targetSha} even with maximum depth ${maxDepth}`);
        return null;
      }

      try {
        this.logger.log(`🔍 Trying clone depth ${depth} for ${owner}/${repo}`);
        
        const repoPath = await this.gitManager.cloneRepository(owner, repo, branch, depth);
        const shaExists = await this.checkShaExists(repoPath, targetSha);
        
        if (shaExists) {
          this.logger.log(`✅ Found target SHA ${targetSha} with depth ${depth}`);
          return { repoPath, depth };
        } else {
          this.logger.log(`❌ Target SHA ${targetSha} not found with depth ${depth}, trying deeper...`);
          await this.gitManager.cleanupRepository(owner, repo);
        }
        
      } catch (cloneError) {
        this.logger.log(`❌ Clone failed with depth ${depth}, trying deeper...`);
        await this.gitManager.cleanupRepository(owner, repo);
      }
    }
    
    this.logger.log(`🔄 Iterative deepening failed, trying git manager's deepenRepository method...`);
    try {
      const repoPath = await this.gitManager.cloneRepository(owner, repo, branch, 1);
      await this.gitManager.deepenRepository(owner, repo, branch, 2000);
      
      const shaExists = await this.checkShaExists(repoPath, targetSha);
      if (shaExists) {
        this.logger.log(`✅ Found target SHA ${targetSha} after deepening repository`);
        return { repoPath, depth: 2000 };
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

  private async ensureRepositoryWithSha(
    owner: string, 
    repo: string, 
    branch: string, 
    targetSha: string
  ): Promise<{ repoPath: string; depth: number } | null> {
    const cloneResult = await this.cloneWithSmartDepth(owner, repo, branch, targetSha);
    
    if (cloneResult) {
      return cloneResult;
    }
    
    this.logger.log(`🔄 Trying shallow clone + deepen for ${owner}/${repo}`);
    try {
      const shallowRepoPath = await this.gitManager.cloneRepository(owner, repo, branch, 1);
      await this.gitManager.deepenRepository(owner, repo, branch, 2000);
      
      const shaExists = await this.checkShaExists(shallowRepoPath, targetSha);
      if (shaExists) {
        this.logger.log(`✅ Found target SHA ${targetSha} after deepening`);
        return { repoPath: shallowRepoPath, depth: 2000 };
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
      if (fs.existsSync(repoPath)) {
        await this.gitManager.cleanupRepository(owner, repo);
      }

      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const { stdout, stderr } = await execAsync(
        `git clone --branch ${branch} --single-branch --depth ${depth} --no-checkout --no-tags ${repoUrl} "${repoPath}"`,
        { timeout: 300000 },
      );

      if (stderr && !stderr.includes('Cloning into')) {
        this.logger.warn(`Git clone stderr: ${stderr}`);
      }

      return repoPath;
    } catch (error) {
      this.logger.error(`Error cloning repository ${owner}/${repo} with depth ${depth}:`, error);

      if (fs.existsSync(repoPath)) {
        await this.gitManager.cleanupRepository(owner, repo);
      }

      throw new Error(
        `Failed to clone repository ${owner}/${repo} with depth ${depth}: ${error.message}`,
      );
    }
  }

  private async getCommitsSinceSha(repoPath: string, sinceSha: string, cloneDepth?: number): Promise<any[]> {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      let verifiedSha = sinceSha;
      try {
        const verifyCommand = `cd "${repoPath}" && git rev-parse --verify ${sinceSha}`;
        const { stdout: verifiedShaOutput } = await execAsync(verifyCommand);
        verifiedSha = verifiedShaOutput.trim();
      } catch (verifyError) {
        this.logger.error(`❌ SHA ${sinceSha} not found in repository, trying alternative approaches...`);
        
        try {
          const findCommand = `cd "${repoPath}" && git log --all --grep="${sinceSha}" --format="%H" -1`;
          const { stdout: foundSha } = await execAsync(findCommand);
          if (foundSha.trim()) {
            verifiedSha = foundSha.trim();
            this.logger.log(`✅ Found SHA ${sinceSha} as ${verifiedSha} in repository history`);
          } else {
            this.logger.error(`❌ Could not find SHA ${sinceSha} in any branch`);
            return [];
          }
        } catch (findError) {
          this.logger.error(`❌ Failed to find SHA ${sinceSha} in repository: ${findError.message}`);
          return [];
        }
      }

      let command = `cd "${repoPath}" && git log ${verifiedSha}..HEAD --pretty=format:"%H|%an|%ae|%ad|%s" --date=iso`;
      let stdout: string;
      
      try {
        const result = await execAsync(command);
        stdout = result.stdout;
      } catch (rangeError) {
        this.logger.warn(`❌ Range ${verifiedSha}..HEAD failed, trying alternative approach...`);
        
        try {
          command = `cd "${repoPath}" && git log --since="${verifiedSha}" --pretty=format:"%H|%an|%ae|%ad|%s" --date=iso`;
          const result = await execAsync(command);
          stdout = result.stdout;
        } catch (sinceError) {
          this.logger.error(`❌ Both range and since approaches failed for SHA ${verifiedSha}`);
          return [];
        }
      }

      if (!stdout.trim()) {
        return [];
      }

      const commits: any[] = [];
      const lines = stdout.trim().split('\n');
      
      const maxCommitsToProcess = cloneDepth ? cloneDepth - 1 : lines.length;
      const linesToProcess = lines.slice(0, maxCommitsToProcess);
      
      if (cloneDepth && lines.length > maxCommitsToProcess) {
        this.logger.log(`📝 Limiting commit processing to ${maxCommitsToProcess} commits (clone depth: ${cloneDepth}) to avoid shallow clone issues`);
      }
      
      for (const line of linesToProcess) {
        const [sha, author, email, date, message] = line.split('|');
        
        const statsCommand = `cd "${repoPath}" && git show --stat --format="" ${sha}`;
        let linesAdded = 0;
        let linesDeleted = 0;
        let filesChanged: string[] = [];
        
        try {
          const { stdout: statsOutput } = await execAsync(statsCommand);
          
          if (commits.length < 3) {
            this.logger.log(`📊 Git stats output for ${sha}:`);
            this.logger.log(statsOutput);
          }
          
          const statsLines = statsOutput.split('\n');
          const summaryLine = statsLines[statsLines.length - 2];
          
          if (summaryLine) {
            const insertionMatch = summaryLine.match(/(\d+) insertions?/);
            const deletionMatch = summaryLine.match(/(\d+) deletions?/);
            
            if (insertionMatch) {
              linesAdded = parseInt(insertionMatch[1], 10);
            }
            if (deletionMatch) {
              linesDeleted = parseInt(deletionMatch[1], 10);
            }
            
            if (commits.length < 3) {
              this.logger.log(`📊 Parsed stats for ${sha}: ${linesAdded} added, ${linesDeleted} deleted, ${filesChanged.length} files`);
            }
          }
          
          const filesCommand = `cd "${repoPath}" && git show --name-only --format="" ${sha}`;
          const { stdout: filesOutput } = await execAsync(filesCommand);
          filesChanged = filesOutput.trim().split('\n').filter(file => file.trim() !== '');
          
          if (filesChanged.length > 100) {
            this.logger.warn(`⚠️ Suspicious file count for commit ${sha}: ${filesChanged.length} files. This might be incorrect.`);
            if (message.toLowerCase().includes('merge') || message.toLowerCase().includes('revert')) {
              this.logger.log(`📝 Commit ${sha} appears to be a merge/revert, high file count may be legitimate`);
            } else {
              try {
                const { stdout: firstCommitOutput } = await execAsync(`cd "${repoPath}" && git log --reverse --format="%H" -1`);
                const firstCommitSha = firstCommitOutput.trim();
                if (sha === firstCommitSha) {
                  this.logger.warn(`🚨 Commit ${sha} appears to be the first commit in a shallow clone. File count of ${filesChanged.length} may be inflated.`);
                  if (filesChanged.length > 50) {
                    filesChanged = filesChanged.slice(0, 50);
                    this.logger.log(`📝 Limited files changed to first 50 for first commit in shallow clone`);
                  }
                }
              } catch (firstCommitError) {
                this.logger.warn(`Could not verify if this is the first commit: ${firstCommitError.message}`);
              }
            }
          }
          
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
            lines_added: commit.linesAdded,
            lines_deleted: commit.linesDeleted,
            files_changed: commit.filesChanged.length,
            payload: {
              sha: commit.sha,
              author: commit.author,
              email: commit.email,
              message: commit.message,
              date: commit.date.toISOString(),
              lines_added: commit.linesAdded,
              lines_deleted: commit.linesDeleted,
              files_changed: commit.filesChanged,
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
      try {
        const busFactorResult = await this.busFactorService.calculateBusFactor(watchlistId);
        
        await this.prisma.busFactorData.deleteMany({
          where: { watchlist_id: watchlistId },
        });
        
        await this.prisma.busFactorData.create({
          data: {
            watchlist_id: watchlistId,
            bus_factor: busFactorResult.busFactor,
            total_contributors: busFactorResult.totalContributors,
            total_commits: busFactorResult.totalCommits,
            top_contributors: JSON.parse(JSON.stringify(busFactorResult.topContributors)),
            risk_level: busFactorResult.riskLevel,
            risk_reason: busFactorResult.riskReason,
            analysis_date: new Date(),
          },
        });
        this.logger.log(`✅ Bus factor updated: ${busFactorResult.busFactor} (${busFactorResult.riskLevel}) - ${busFactorResult.totalContributors} contributors`);
      } catch (error) {
        this.logger.error(`❌ Bus factor calculation failed for ${watchlistId}: ${error.message}`);
      }
      
      try {
        const existingStats = await this.prisma.contributorStats.findFirst({
          where: { watchlist_id: watchlistId }
        });
        
        if (!existingStats) {
          await this.gitManager.updateContributorStats(watchlistId);
        }
      } catch (error) {
        this.logger.warn(`⚠️ Contributor stats update skipped for ${watchlistId}: ${error.message}`);
      }
    } catch (error) {
      this.logger.error(`Error updating statistics:`, error);
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

  async triggerPolling() {
    this.logger.log('Manually triggering daily polling...');
    await this.triggerDailyPolling();
  }

  private createEventHash(data: string): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  private async updateActivityScore(watchlistId: string): Promise<void> {
    try {
      this.logger.log(`📈 Updating activity score for watchlist ${watchlistId}`);

      const commits = await this.prisma.log.findMany({
        where: {
          watchlist_id: watchlistId,
          event_type: 'COMMIT',
        },
        orderBy: { timestamp: 'desc' },
        select: {
          actor: true,
          timestamp: true,
          payload: true,
        },
      });

      this.logger.log(`📝 Found ${commits.length} commits for activity analysis`);

      if (commits.length === 0) {
        this.logger.log(`No commits found for activity analysis`);
        return;
      }

      const commitsForAnalysis = commits.map((log) => {
        const payload = log.payload as any;
        
        const linesAdded = payload.lines_added || 0;
        const linesDeleted = payload.lines_deleted || 0;
        const filesChanged = payload.files_changed || [];
        
        return {
          sha: payload.sha,
          author: log.actor,
          email: payload.email || '',
          date: new Date(log.timestamp + 'Z'),
          message: payload.message,
          filesChanged,
          linesAdded,
          linesDeleted,
        };
      });

      const activityScore = this.activityAnalysisService.calculateActivityScore(commitsForAnalysis);
      const weeklyCommitRate = this.activityAnalysisService.calculateWeeklyCommitRate(commitsForAnalysis);
      const activityHeatmap = this.activityAnalysisService.generateActivityHeatmap(commitsForAnalysis);

      await this.prisma.activityData.deleteMany({
        where: { watchlist_id: watchlistId },
      });

      await this.prisma.activityData.create({
        data: {
          watchlist_id: watchlistId,
          activity_score: activityScore.score,
          activity_level: activityScore.level,
          weekly_commit_rate: weeklyCommitRate,
          activity_factors: JSON.parse(JSON.stringify(activityScore.factors)),
          activity_heatmap: JSON.parse(JSON.stringify(activityHeatmap)),
          peak_activity: {
            day: activityHeatmap.peakActivity.day,
            hour: activityHeatmap.peakActivity.hour,
            count: activityHeatmap.peakActivity.count,
          },
          analysis_date: new Date(),
        },
      });

      this.logger.log(`Activity score updated for ${watchlistId}`);
    } catch (error) {
      this.logger.error(`Error updating activity score: ${error.message}`);
    }
  }

  private async checkNewCommitsForAnomalies(watchlistId: string, newCommits: any[]): Promise<void> {
    try {
      if (newCommits.length === 0) {
        this.logger.log(`📝 No new commits to check for anomalies`);
        return;
      }

      this.logger.log(`🔍 Checking ${newCommits.length} new commits for AI anomalies`);

      const contributorStats = await this.prisma.contributorStats.findMany({
        where: { watchlist_id: watchlistId },
      });

      const repoStats = await this.prisma.repoStats.findFirst({
        where: { watchlist_id: watchlistId },
      });

      for (const commit of newCommits) {
        try {
          if (!commit || !commit.payload) {
            this.logger.warn(`⚠️ Skipping invalid commit object for AI analysis`);
            continue;
          }

          const payload = commit.payload as any;
          
          if (!payload.sha) {
            this.logger.warn(`⚠️ Skipping commit without SHA for AI analysis`);
            continue;
          }

          const analysisData = {
            sha: payload.sha,
            author: commit.actor || 'unknown',
            email: payload.email || 'unknown@example.com',
            message: payload.message || '',
            date: commit.timestamp || new Date(),
            linesAdded: payload.lines_added || 0,
            linesDeleted: payload.lines_deleted || 0,
            filesChanged: payload.files_changed || [],
            contributorStats: contributorStats.find(cs => cs.author_email === payload.email) ? {
              avgLinesAdded: contributorStats.find(cs => cs.author_email === payload.email)!.avg_lines_added,
              avgLinesDeleted: contributorStats.find(cs => cs.author_email === payload.email)!.avg_lines_deleted,
              avgFilesChanged: contributorStats.find(cs => cs.author_email === payload.email)!.avg_files_changed,
              stddevLinesAdded: contributorStats.find(cs => cs.author_email === payload.email)!.stddev_lines_added,
              stddevLinesDeleted: contributorStats.find(cs => cs.author_email === payload.email)!.stddev_lines_deleted,
              stddevFilesChanged: contributorStats.find(cs => cs.author_email === payload.email)!.stddev_files_changed,
              totalCommits: contributorStats.find(cs => cs.author_email === payload.email)!.total_commits,
            } : undefined,
            repoStats: repoStats ? {
              avgLinesAdded: repoStats.avg_lines_added,
              avgLinesDeleted: repoStats.avg_lines_deleted,
              avgFilesChanged: repoStats.avg_files_changed,
              totalCommits: repoStats.total_commits,
              totalContributors: contributorStats.length,
            } : undefined,
          };

          await this.aiAnomalyDetectionService.analyzeAndStoreAnomaly(
            watchlistId,
            analysisData,
          );

        } catch (error) {
          this.logger.error(`Failed to analyze commit ${commit?.event_id || 'unknown'} for anomalies:`, error);
        }
      }

      this.logger.log(`✅ Completed AI anomaly detection for ${newCommits.length} new commits`);
    } catch (error) {
      this.logger.error('Failed to check new commits for anomalies:', error);
    }
  }
} 