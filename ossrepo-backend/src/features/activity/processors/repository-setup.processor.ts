import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { GitManagerService } from '../services/git-manager.service';
import { HealthAnalysisService } from '../services/health-analysis.service';

export interface RepositorySetupJobData {
  watchlistId: string;
  owner: string;
  repo: string;
  branch?: string;
}

@Processor('repository-setup')
export class RepositorySetupProcessor {
  private readonly logger = new Logger(RepositorySetupProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gitManagerService: GitManagerService,
    private readonly healthAnalysisService: HealthAnalysisService,
  ) {}

  @Process('clone-and-analyze')
  async handleCloneAndAnalyze(job: Job<RepositorySetupJobData>) {
    const { watchlistId, owner, repo, branch = 'main' } = job.data;
    
    this.logger.log(`\n🚀 Starting setup for ${owner}/${repo}\n`);
    
    try {
      // Update status to processing
      await this.updateWatchlistStatus(watchlistId, 'processing', new Date());
      
      // Step 1: Clone repository
      const repoPath = await this.gitManagerService.cloneRepository(owner, repo, branch);
      
      // Step 2: Backfill commit history and get commits
      const { commitCount, commits } = await this.gitManagerService.backfillCommitsForRepo(owner, repo, branch, watchlistId);
      
      // Step 3: Run historical health analysis
      const healthResults = await this.healthAnalysisService.runHistoricalHealthAnalysis(
        watchlistId, 
        owner, 
        repo, 
        commits, 
        branch
      );
      
      // Step 4: Clean up the repository after all processing is complete
      await this.gitManagerService.cleanupRepository(owner, repo);
      
      // Step 5: Update status to ready
      await this.updateWatchlistStatus(watchlistId, 'ready', undefined, new Date());
      
      this.logger.log(`✅ Setup completed for ${owner}/${repo}`);
      this.logger.log(`   📚 ${commitCount} commits processed`);
      this.logger.log(`   📊 Current health score: ${healthResults.current}/100`);
      this.logger.log(`   📈 Historical health checks: ${healthResults.historical.length}\n`);
      
    } catch (error) {
      this.logger.error(`❌ Setup failed for ${owner}/${repo}: ${error.message}\n`);
      
      // Clean up repository on failure
      try {
        await this.gitManagerService.cleanupRepository(owner, repo);
      } catch (cleanupError) {
        this.logger.warn(`⚠️ Failed to cleanup repository ${owner}/${repo} after error`);
      }
      
      // Update status to failed
      await this.updateWatchlistStatus(
        watchlistId, 
        'failed', 
        undefined, 
        undefined, 
        error.message
      );
      
      throw error; // Re-throw to trigger job retry
    }
  }

  private async updateWatchlistStatus(
    watchlistId: string,
    status: 'processing' | 'ready' | 'failed',
    processingStartedAt?: Date,
    processingCompletedAt?: Date,
    lastError?: string,
  ) {
    await this.prisma.watchlist.update({
      where: { watchlist_id: watchlistId },
      data: {
        status,
        processing_started_at: processingStartedAt,
        processing_completed_at: processingCompletedAt,
        last_error: lastError,
        updated_at: new Date(),
      },
    });
  }
} 