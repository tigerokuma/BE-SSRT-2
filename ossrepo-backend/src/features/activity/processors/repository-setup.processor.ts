import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { GitManagerService } from '../services/git-manager.service';
import { ScorecardService } from '../services/scorecard.service';
import { HealthAnalysisService } from '../services/health-analysis.service';
import { RateLimitManagerService } from '../services/rate-limit-manager.service';
import { GitHubApiService } from '../services/github-api.service';

interface RepositorySetupJobData {
  watchlistId: string;
  owner: string;
  repo: string;
  branch: string;
  isLargeRepo: boolean;
  repoSizeKB: number;
  maxCommits?: number; // Optional override for commit count
  forceLocalCloning?: boolean; // Force local cloning instead of API
  forceLocalHealthAnalysis?: boolean; // Force local health analysis instead of Scorecard
}

@Processor('repository-setup')
export class RepositorySetupProcessor {
  private readonly logger = new Logger(RepositorySetupProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gitManager: GitManagerService,
    private readonly scorecardService: ScorecardService,
    private readonly healthAnalysisService: HealthAnalysisService,
    private readonly rateLimitManager: RateLimitManagerService,
    private readonly githubApi: GitHubApiService,
  ) {}

  @Process('clone-and-analyze')
  async handleRepositorySetup(job: Job<RepositorySetupJobData>) {
    const { watchlistId, owner, repo, branch, isLargeRepo, repoSizeKB, maxCommits, forceLocalCloning, forceLocalHealthAnalysis } = job.data;
    const startTime = Date.now();
    
    this.logger.log(`🚀 Starting repository setup for ${owner}/${repo} (watchlist: ${watchlistId})`);
    
    try {
      await this.prisma.watchlist.update({
        where: { watchlist_id: watchlistId },
        data: {
          status: 'processing',
          processing_started_at: new Date(),
          last_error: null,
        },
      });

      // Determine processing strategy based on rate limits
      const strategy = await this.rateLimitManager.getProcessingStrategy();
      const rateLimit = await this.rateLimitManager.getRateLimitStatus();
      this.logger.log(`🎯 Using ${strategy.reason.split('(')[0].trim()} (${rateLimit.remaining}/${rateLimit.limit} remaining)`);

      // Check if we should use API for this specific repository (unless forced to use local)
      const shouldUseApiForRepo = forceLocalCloning ? false : await this.rateLimitManager.shouldUseApiForRepo(repoSizeKB);
      const shouldUseApiForCommits = forceLocalCloning ? false : shouldUseApiForRepo; // Use repo-specific decision instead of global

      let commitCount = 0;
      let repoPath: string | null = null;

      const twoYearsAgo = new Date();
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
      const now = new Date();
      
      // Step 1: Fetch commits AND Scorecard data in parallel for maximum speed
      let commitsResult: any[] | null = null;
      let historicalScorecardData: any[] = [];
      
      // Start both operations in parallel
      const parallelOperations: Promise<{ type: string; data?: any; error?: any }>[] = [];
      
      // Start commit fetching
      if (shouldUseApiForCommits) {
        this.logger.log(`📡 Fetching commits via GitHub API (max: ${maxCommits || 2000})`);
        parallelOperations.push(
          this.githubApi.getLatestCommits(owner, repo, branch, maxCommits || 2000)
            .then(result => ({ type: 'commits', data: result }))
            .catch(error => ({ type: 'commits', error }))
        );
      }
      
      // Start Scorecard API call in parallel (unless forced to local)
      if (!forceLocalHealthAnalysis) {
        this.logger.log(`🔍 Fetching Scorecard data for ${owner}/${repo}`);
        parallelOperations.push(
          this.scorecardService.getHistoricalScorecardData(owner, repo, twoYearsAgo, now)
            .then(data => ({ type: 'scorecard', data }))
            .catch(error => ({ type: 'scorecard', error }))
        );
      }
      
      // Wait for parallel operations to complete
      const results = await Promise.all(parallelOperations);
      
      // Process commit results
      const commitResult = results.find(r => r.type === 'commits');
      if (commitResult && !commitResult.error) {
        commitsResult = commitResult.data;
      } else if (commitResult?.error) {
        this.logger.warn(`⚠️ GitHub API failed, will fall back to local cloning: ${commitResult.error.message}`);
      }
      
      // Process Scorecard results
      const scorecardResult = results.find(r => r.type === 'scorecard');
      if (scorecardResult && !scorecardResult.error) {
        historicalScorecardData = scorecardResult.data;
      } else if (scorecardResult?.error) {
        this.logger.warn(`⚠️ Scorecard API failed: ${scorecardResult.error.message}`);
      }
      
      // Handle commit results
      let commitsForHealthAnalysis: any[] = [];
      
      if (commitsResult) {
        commitCount = commitsResult.length;
        commitsForHealthAnalysis = commitsResult;
        this.logger.log(`📝 Logging ${commitCount} commits to database (from API)`);
        await this.logCommitsToDatabase(watchlistId, commitsResult);
      } else {
        // Fall back to local cloning
        this.logger.log(`💾 Using local cloning for commit fetching`);
        repoPath = await this.gitManager.cloneRepository(owner, repo, branch);
        const result = await this.gitManager.backfillCommitsForRepo(owner, repo, branch, watchlistId);
        commitCount = result.commitCount;
        commitsForHealthAnalysis = result.commits;
        this.logger.log(`📝 Logged ${commitCount} commits to database (from local cloning)`);
      }

      // Step 2: Handle health analysis results
      if (forceLocalHealthAnalysis) {
        // Force local health analysis - skip Scorecard API entirely
        this.logger.log(`🧪 Forcing local health analysis (skipping Scorecard API)`);
        const transformedCommits = this.transformCommitsForHealthAnalysis(commitsForHealthAnalysis);
        
        try {
          const localAnalysis = await this.healthAnalysisService.runLocalHistoricalAnalysis(watchlistId, owner, repo, transformedCommits, branch);
          this.logger.log(`✅ Local health analysis completed with ${localAnalysis.historical.length} historical results`);
          historicalScorecardData = localAnalysis.historical.map(result => ({
            date: result.date.toISOString(),
            score: result.score,
            commitSha: result.commitSha,
            source: 'local-analysis'
          }));
        } catch (error) {
          this.logger.error(`❌ Local health analysis failed: ${error.message}`);
          historicalScorecardData = [];
        }
      } else if (historicalScorecardData.length === 0) {
        // No Scorecard data available, fall back to local analysis
        this.logger.log(`❌ No Scorecard data found, using local health analysis instead`);
        
        // Always run health analysis, even if no commits (to get current health metrics)
        if (commitsForHealthAnalysis.length === 0) {
          this.logger.log(`📊 No commits found, running health analysis on repository head`);
          const currentHealth = await this.healthAnalysisService.analyzeRepository(watchlistId, owner, repo, branch, undefined, true); // Skip Scorecard query
          this.logger.log(`   📈 ${new Date().toISOString().split('T')[0]}: ${currentHealth}/100`);
          historicalScorecardData = [{
            date: new Date().toISOString(),
            score: currentHealth,
            commitSha: 'HEAD',
            source: 'local-analysis-current'
          }];
        } else {
          const transformedCommits = this.transformCommitsForHealthAnalysis(commitsForHealthAnalysis);
          const localAnalysis = await this.healthAnalysisService.runHistoricalHealthAnalysis(watchlistId, owner, repo, transformedCommits, branch, true); // Skip Scorecard query
          historicalScorecardData = localAnalysis.historical.map(result => ({
            date: result.date.toISOString(),
            score: result.score,
            commitSha: result.commitSha,
            source: 'local-analysis'
          }));
        }
      } else {
        this.logger.log(`✅ Found ${historicalScorecardData.length} Scorecard records for ${owner}/${repo}`);
      }

      await this.prisma.watchlist.update({
        where: { watchlist_id: watchlistId },
        data: {
          status: 'ready',
          processing_completed_at: new Date(),
          commits_since_last_health_update: commitCount,
          last_error: null,
        },
      });

      // Clean up local repository if we cloned it
      if (repoPath) {
        await this.gitManager.cleanupRepository(owner, repo);
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      const healthMetricsCount = historicalScorecardData.length;
      this.logger.log(`✅ Repository setup completed in ${duration}s - ${commitCount} commits retrieved, ${healthMetricsCount} health metrics retrieved`);

      const result = { 
        success: true, 
        commitCount, 
        healthMetricsCount,
        hasScorecardData: healthMetricsCount > 0,
        strategy: strategy.reason,
        usedApiForCommits: shouldUseApiForCommits,
        usedLocalCloning: !!repoPath,
        duration: `${duration}s`
      };
      
      return result;
    } catch (error) {
      this.logger.error(`❌ Repository setup failed for ${owner}/${repo}:`, error.message);
      await this.prisma.watchlist.update({
        where: { watchlist_id: watchlistId },
        data: { status: 'failed', last_error: error.message },
      });
      
      this.logger.log(`💥 Job failed for ${owner}/${repo}`);
      
      throw error;
    }
  }

  /**
   * Log commits to database from GitHub API data with optimized processing
   */
  private async logCommitsToDatabase(watchlistId: string, commits: any[]): Promise<void> {
    try {
      this.logger.log(`🔄 Processing ${commits.length} commits in batches of 1000`);
      
      // Get the last log entry for this repository to start the hash chain
      const lastLog = await this.prisma.log.findFirst({
        where: { watchlist_id: watchlistId },
        orderBy: { timestamp: 'desc' },
      });
      
      let currentPrevHash = lastLog ? lastLog.event_hash : null;
      let processedCount = 0;
      let skippedCount = 0;
      const batchSize = 1000; // Increased batch size to process more commits efficiently
      
      for (let i = 0; i < commits.length; i += batchSize) {
        const batch = commits.slice(i, i + batchSize);
        
        // Check for existing commits first to avoid unnecessary operations
        const eventIds = batch.map(commit => `commit_${commit.sha}`);
        const existingLogs = await this.prisma.log.findMany({
          where: { 
            event_id: { in: eventIds },
            watchlist_id: watchlistId 
          },
          select: { event_id: true }
        });
        
        const existingEventIds = new Set(existingLogs.map(log => log.event_id));
        
        // Process only new commits
        const newCommits = batch.filter(commit => !existingEventIds.has(`commit_${commit.sha}`));
        
        if (newCommits.length === 0) {
          skippedCount += batch.length;
          continue;
        }
        
        // Process new commits in parallel
        const commitPromises = newCommits.map(async (commit) => {
          const payload = {
            sha: commit.sha,
            message: commit.commit.message,
            author: commit.commit.author.name,
            author_email: commit.commit.author.email,
            committer: commit.commit.committer.name,
            committer_email: commit.commit.committer.email,
            date: commit.commit.author.date,
            parents: commit.parents.map((p: any) => p.sha),
          };
          
          const logData = {
            watchlist_id: watchlistId,
            event_type: 'COMMIT',
            actor: commit.commit.author.name,
            timestamp: new Date(commit.commit.author.date),
            payload,
            prev_event_hash: currentPrevHash,
          };
          
          const eventHash = this.createEventHash(logData);
          
          await this.prisma.log.create({
            data: {
              event_id: `commit_${commit.sha}`,
              event_type: 'COMMIT',
              actor: commit.commit.author.name,
              timestamp: new Date(commit.commit.author.date),
              payload,
              event_hash: eventHash,
              prev_event_hash: currentPrevHash,
              watchlist_id: watchlistId,
            },
          });
          
          currentPrevHash = eventHash;
          processedCount++;
        });
        
        // Wait for batch to complete
        await Promise.all(commitPromises);
        skippedCount += (batch.length - newCommits.length);
        
        this.logger.log(`📊 Batch ${Math.floor(i / batchSize) + 1}: Processed ${newCommits.length} new commits, skipped ${batch.length - newCommits.length} existing`);
      }
      
      this.logger.log(`✅ Commit logging completed: ${processedCount} processed, ${skippedCount} skipped`);
    } catch (error) {
      this.logger.error(`❌ Error logging commits to database:`, error.message);
      throw error;
    }
  }

  /**
   * Transform commits to the format expected by health analysis
   * Handles both GitHub API format and local git format
   */
  private transformCommitsForHealthAnalysis(commits: any[]): any[] {
    return commits.map(commit => {
      // Handle GitHub API format (nested commit structure)
      if (commit.commit && commit.commit.author) {
        return {
          sha: commit.sha,
          date: commit.commit.author.date,
          message: commit.commit.message,
          author: commit.commit.author.name,
          author_email: commit.commit.author.email,
          committer: commit.commit.committer.name,
          committer_email: commit.commit.committer.email,
          parents: commit.parents?.map((p: any) => p.sha) || [],
        };
      }
      
      // Handle local git format (flat structure)
      return {
        sha: commit.sha,
        date: commit.date,
        message: commit.message,
        author: commit.author,
        author_email: commit.email,
        committer: commit.author, // Local git doesn't separate committer
        committer_email: commit.email,
        parents: [], // Local git doesn't provide parents in this format
      };
    });
  }

  /**
   * Create a hash for a log event (hash chain)
   */
  private createEventHash(logData: any): string {
    const { createHash } = require('crypto');
    const hash = createHash('sha256');
    hash.update(JSON.stringify(logData));
    return hash.digest('hex');
  }
}