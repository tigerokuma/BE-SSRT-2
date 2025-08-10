import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { HealthAnalysisService } from '../services/health-analysis.service';

interface HealthCheckJobData {
  watchlistId?: string; // Optional: if provided, check only this repository
}

@Processor('health-check')
export class HealthCheckProcessor {
  private readonly logger = new Logger(HealthCheckProcessor.name);
  private isProcessingMonthlyCheck = false; // Prevent concurrent monthly checks

  constructor(
    private readonly prisma: PrismaService,
    private readonly healthAnalysisService: HealthAnalysisService,
    @InjectQueue('health-check') private readonly healthQueue: Queue,
  ) {
    // Removed automatic health check initialization to prevent duplicate jobs on server restart
    // Health checking should be manually triggered or scheduled externally
  }

  /**
   * Initialize the monthly health check schedule (call this to make the queue visible in BullMQ)
   */
  async initializeHealthCheckSchedule() {
    this.logger.log('🚀 Initializing monthly health check schedule...');
    
    try {
      // First, add an immediate job to make the queue visible
      await this.healthQueue.add(
        'monthly-health-check',
        {},
        {
          attempts: 1,
          removeOnComplete: 10,
          removeOnFail: 50,
        },
      );
      
      this.logger.log('✅ Added immediate health check job to make queue visible');
      
      // Then schedule the next monthly check
      await this.initializeMonthlyHealthCheck();
    } catch (error) {
      this.logger.error('Error initializing monthly health check schedule:', error);
      throw error;
    }
  }

  /**
   * Monthly job that checks all repositories for health using Scorecard
   */
  async triggerMonthlyHealthCheck() {
    // Prevent concurrent monthly checks
    if (this.isProcessingMonthlyCheck) {
      this.logger.log('⏳ Monthly health check already in progress, skipping...');
      return;
    }

    this.isProcessingMonthlyCheck = true;

    this.logger.log(
      `\n────────────────────────────────────────────────────────────\n🔍 MONTHLY HEALTH CHECK TRIGGERED\n────────────────────────────────────────────────────────────`
    );

    try {
      // Get all ready repositories from watchlist
      const watchlistedRepos = await this.prisma.watchlist.findMany({
        where: {
          status: 'ready',
        },
        select: {
          watchlist_id: true,
          default_branch: true,
          package: {
            select: {
              repo_url: true,
              repo_name: true,
              package_name: true,
            }
          },
        },
      });

      this.logger.log(`Found ${watchlistedRepos.length} ready repositories to check for health`);

      // Process repositories sequentially
      let processedCount = 0;
      let successfulChecks = 0;

      for (const repo of watchlistedRepos) {
        const { repo_url, repo_name, package_name } = repo.package;
        const { default_branch } = repo;
        
        if (!repo_url) {
          this.logger.warn(`No repo URL found for ${repo_name}, skipping`);
          continue;
        }

        if (!default_branch) {
          this.logger.warn(`No default branch found for ${repo_name}, skipping`);
          continue;
        }

        try {
          // Parse owner and repo from URL
          const urlParts = repo_url.split('/');
          const owner = urlParts[urlParts.length - 2];
          const repoName = urlParts[urlParts.length - 1];

          await this.checkRepositoryHealth(
            repo.watchlist_id,
            owner,
            repoName,
            default_branch,
            repo_name
          );
          
          successfulChecks++;
          processedCount++;
          
          // Small delay between repositories to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
          this.logger.error(`Error checking health for ${repo_name}:`, error);
          // Continue with next repository instead of failing entire process
        }
      }

      this.logger.log(`✅ Completed health check for ${processedCount}/${watchlistedRepos.length} repositories`);
      this.logger.log(`🎯 Successfully analyzed ${successfulChecks} repositories`);

      // Schedule the next monthly health check for 2 months from now
      await this.scheduleNextMonthlyHealthCheck();
    } catch (error) {
      this.logger.error('Error during monthly health check trigger:', error);
    } finally {
      this.isProcessingMonthlyCheck = false;
    }
  }

  /**
   * Check health for a single repository
   */
  private async checkRepositoryHealth(
    watchlistId: string,
    owner: string,
    repo: string,
    branch: string,
    repoName: string
  ): Promise<void> {
    try {
      this.logger.log(`🔍 Checking health for ${repoName} (${owner}/${repo})`);

      // Run health analysis using Scorecard
      const healthScore = await this.healthAnalysisService.analyzeRepository(
        watchlistId,
        owner,
        repo,
        branch
      );

      this.logger.log(`✅ Health check completed for ${repoName} - Score: ${healthScore}`);
    } catch (error) {
      this.logger.error(`Error checking health for ${repoName}:`, error);
      throw error;
    }
  }

  /**
   * Schedule the next monthly health check
   */
  private async scheduleNextMonthlyHealthCheck(): Promise<void> {
    try {
      // Check if there's already a monthly health check job scheduled
      const waitingJobs = await this.healthQueue.getWaiting();
      const existingMonthlyCheckJob = waitingJobs.find(job => job.name === 'monthly-health-check');
      
      if (existingMonthlyCheckJob) {
        this.logger.log('📅 Monthly health check job already scheduled, skipping duplicate');
        return;
      }

      // Calculate delay until 2 months from now
      const now = new Date();
      const nextMonth = new Date(now);
      nextMonth.setMonth(nextMonth.getMonth() + 2);
      nextMonth.setHours(0, 0, 0, 0); // Set to midnight
      
      const delayMs = nextMonth.getTime() - now.getTime();
      
      await this.healthQueue.add(
        'monthly-health-check',
        {},
        {
          delay: delayMs,
          attempts: 1, // Don't retry monthly health check if it fails
          removeOnComplete: 10,
          removeOnFail: 50,
        },
      );

      this.logger.log(`📅 Scheduled next monthly health check for ${nextMonth.toISOString()}`);
    } catch (error) {
      this.logger.error('Error scheduling next monthly health check:', error);
    }
  }

  /**
   * Initialize monthly health checking schedule
   */
  private async initializeMonthlyHealthCheck(): Promise<void> {
    try {
      // Check if there's already a monthly health check job scheduled
      const waitingJobs = await this.healthQueue.getWaiting();
      const monthlyCheckJob = waitingJobs.find(job => job.name === 'monthly-health-check');
      
      if (!monthlyCheckJob) {
        this.logger.log('🚀 Initializing monthly health check schedule...');
        await this.scheduleNextMonthlyHealthCheck();
      } else {
        this.logger.log('📅 Monthly health check schedule already exists');
      }
    } catch (error) {
      this.logger.error('Error initializing monthly health check:', error);
    }
  }

  @Process('monthly-health-check')
  async handleMonthlyHealthCheck(job: Job) {
    this.logger.log('🕛 Monthly health check job triggered');
    await this.triggerMonthlyHealthCheck();
  }

  @Process('check-single-repository-health')
  async handleSingleRepositoryHealthCheck(job: Job<HealthCheckJobData>) {
    const { watchlistId } = job.data;
    
    if (!watchlistId) {
      this.logger.error('No watchlistId provided for single repository health check');
      return;
    }

    this.logger.log(`🔍 Single repository health check triggered for ${watchlistId}`);

    try {
      const watchlist = await this.prisma.watchlist.findUnique({
        where: { watchlist_id: watchlistId },
        include: {
          package: {
            select: {
              repo_url: true,
              repo_name: true,
              package_name: true,
            }
          }
        }
      });

      if (!watchlist || !watchlist.package) {
        this.logger.error(`No package found for watchlist ${watchlistId}`);
        return;
      }

      const { repo_url, repo_name } = watchlist.package;
      const { default_branch } = watchlist;
      
      if (!repo_url) {
        this.logger.error(`No repo URL found for watchlist ${watchlistId}`);
        return;
      }

      if (!default_branch) {
        this.logger.error(`No default branch found for watchlist ${watchlistId}`);
        return;
      }

      // Parse owner and repo from URL
      const urlParts = repo_url.split('/');
      const owner = urlParts[urlParts.length - 2];
      const repo = urlParts[urlParts.length - 1];

      await this.checkRepositoryHealth(watchlistId, owner, repo, default_branch, repo_name);
    } catch (error) {
      this.logger.error(`Error in single repository health check for ${watchlistId}:`, error);
    }
  }
}
