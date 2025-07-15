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
    
    this.logger.log(`Starting repository setup for ${owner}/${repo} (watchlist: ${watchlistId})`);
    
    try {
      // Update status to processing
      await this.updateWatchlistStatus(watchlistId, 'processing', new Date());
      
      // Step 1: Clone repository
      this.logger.log(`Cloning repository ${owner}/${repo}`);
      const repoPath = await this.gitManagerService.cloneRepository(owner, repo, branch);
      
      // Step 2: Backfill commit history
      this.logger.log(`Backfilling commit history for ${owner}/${repo}`);
      await this.gitManagerService.backfillCommitsForRepo(owner, repo, branch, watchlistId);
      
      // Step 3: Run initial health analysis
      this.logger.log(`Running initial health analysis for ${owner}/${repo}`);
      await this.healthAnalysisService.analyzeRepository(
        parseInt(watchlistId), 
        owner, 
        repo, 
        branch
      );
      
      // Step 4: Update status to ready
      await this.updateWatchlistStatus(watchlistId, 'ready', undefined, new Date());
      
      this.logger.log(`✅ Repository setup completed for ${owner}/${repo}`);
      
    } catch (error) {
      this.logger.error(`❌ Repository setup failed for ${owner}/${repo}:`, error);
      
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