import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { HealthAnalysisService } from '../services/health-analysis.service';

interface HealthCheckJobData {
  watchlistId?: string;
}

@Processor('health-check')
export class HealthCheckProcessor {
  private readonly logger = new Logger(HealthCheckProcessor.name);
  private isProcessingMonthlyCheck = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly healthAnalysisService: HealthAnalysisService,
    @InjectQueue('health-check') private readonly healthQueue: Queue,
  ) {}

  async initializeHealthCheckSchedule() {
    this.logger.log('🚀 Initializing monthly health check schedule...');
    
    try {
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
      await this.initializeMonthlyHealthCheck();
    } catch (error) {
      this.logger.error('Error initializing monthly health check schedule:', error);
      throw error;
    }
  }

  async triggerMonthlyHealthCheck() {
    if (this.isProcessingMonthlyCheck) {
      this.logger.log('⏳ Monthly health check already in progress, skipping...');
      return;
    }

    this.isProcessingMonthlyCheck = true;

    this.logger.log(
      `\n────────────────────────────────────────────────────────────\n🔍 MONTHLY HEALTH CHECK TRIGGERED\n────────────────────────────────────────────────────────────`
    );

    try {
      const watchlistedRepos = await this.prisma.watchlist.findMany({
        where: { status: 'ready' },
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

      let processedCount = 0;
      let successfulChecks = 0;

      for (const repo of watchlistedRepos) {
        const { repo_url, repo_name } = repo.package;
        const { default_branch } = repo;
        
        if (!repo_url || !default_branch) {
          this.logger.warn(`Missing repo URL or default branch for ${repo_name}, skipping`);
          continue;
        }

        try {
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
          
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
          this.logger.error(`Error checking health for ${repo_name}:`, error);
        }
      }

      this.logger.log(`✅ Completed health check for ${processedCount}/${watchlistedRepos.length} repositories`);
      this.logger.log(`🎯 Successfully analyzed ${successfulChecks} repositories`);

      await this.scheduleNextMonthlyHealthCheck();
    } catch (error) {
      this.logger.error('Error during monthly health check trigger:', error);
    } finally {
      this.isProcessingMonthlyCheck = false;
    }
  }

  private async checkRepositoryHealth(
    watchlistId: string,
    owner: string,
    repo: string,
    branch: string,
    repoName: string
  ): Promise<void> {
    try {
      this.logger.log(`🔍 Checking health for ${repoName} (${owner}/${repo})`);

      const healthScore = await this.healthAnalysisService.analyzeRepository(
        watchlistId,
        owner,
        repo,
        branch
      );

      this.logger.log(`✅ Health check completed for ${repoName} - Score: ${healthScore}`);
      await this.checkHealthScoreDecrease(watchlistId, healthScore, repoName);
    } catch (error) {
      this.logger.error(`Error checking health for ${repoName}:`, error);
      throw error;
    }
  }

  private async checkHealthScoreDecrease(
    watchlistId: string,
    currentHealthScore: number,
    repoName: string
  ): Promise<void> {
    try {
      const previousHealthData = await this.prisma.healthData.findFirst({
        where: { watchlist_id: watchlistId },
        orderBy: { analysis_date: 'desc' },
        select: { overall_health_score: true, analysis_date: true },
      });

      if (!previousHealthData) {
        this.logger.log(`No previous health data found for ${repoName}, skipping health decrease check`);
        return;
      }

      const previousHealthScore = Number(previousHealthData.overall_health_score);
      const healthScoreDecrease = previousHealthScore - currentHealthScore;

      if (healthScoreDecrease <= 0) {
        this.logger.log(`Health score for ${repoName} has not decreased (${previousHealthScore} → ${currentHealthScore})`);
        return;
      }

      this.logger.log(`📉 Health score decreased for ${repoName}: ${previousHealthScore} → ${currentHealthScore} (decrease: ${healthScoreDecrease.toFixed(1)})`);

      const userWatchlists = await this.prisma.userWatchlist.findMany({
        where: { watchlist_id: watchlistId },
        select: {
          id: true,
          user_id: true,
          alerts: true,
        },
      });

      if (userWatchlists.length === 0) {
        this.logger.log(`No users watching repository ${watchlistId}`);
        return;
      }

      for (const userWatchlist of userWatchlists) {
        let alertSettings;
        try {
          alertSettings = userWatchlist.alerts ? JSON.parse(userWatchlist.alerts) : {};
        } catch (parseError) {
          this.logger.warn(`Failed to parse alert settings for user ${userWatchlist.user_id}, using default settings`);
          alertSettings = {};
        }

        if (alertSettings.health_score_decreases?.enabled) {
          const userThreshold = alertSettings.health_score_decreases.minimum_health_change || 1.0;
          
          if (healthScoreDecrease >= userThreshold) {
            await this.createHealthScoreDecreaseAlert(
              userWatchlist.id,
              watchlistId,
              previousHealthScore,
              currentHealthScore,
              healthScoreDecrease,
              repoName
            );
            this.logger.log(`✅ Health score decrease alert created for user ${userWatchlist.user_id} (decrease: ${healthScoreDecrease.toFixed(1)}, threshold: ${userThreshold})`);
          } else {
            this.logger.log(`⏭️ Health score decrease (${healthScoreDecrease.toFixed(1)}) below user threshold (${userThreshold}) for user ${userWatchlist.user_id}`);
          }
        } else {
          this.logger.log(`⏭️ Skipping health score decrease alert for user ${userWatchlist.user_id} (alerts disabled)`);
        }
      }
    } catch (error) {
      this.logger.error(`Error checking health score decrease for ${repoName}:`, error);
    }
  }

  private async createHealthScoreDecreaseAlert(
    userWatchlistId: string,
    watchlistId: string,
    previousScore: number,
    currentScore: number,
    decrease: number,
    repoName: string
  ): Promise<void> {
    try {
      const details = {
        healthScore: {
          previousScore: previousScore,
          currentScore: currentScore,
          decrease: decrease,
          decreasePercentage: ((decrease / previousScore) * 100).toFixed(1),
        },
        repository: {
          name: repoName,
          watchlistId: watchlistId,
        },
      };

      await this.prisma.alertTriggered.create({
        data: {
          user_watchlist_id: userWatchlistId,
          watchlist_id: watchlistId,
          commit_sha: 'health-check',
          contributor: 'health-system',
          metric: 'health_score_decrease',
          value: decrease,
          alert_level: 'moderate',
          threshold_type: 'health_score_decrease',
          threshold_value: 0,
          description: `Health score decreased by ${decrease.toFixed(1)} points in ${repoName} (${previousScore.toFixed(1)} → ${currentScore.toFixed(1)})`,
          details_json: details,
        },
      });

      this.logger.log(
        `🚨 HEALTH SCORE DECREASE ALERT CREATED: ${repoName} - Decrease: ${decrease.toFixed(1)} points`,
      );
    } catch (error) {
      this.logger.error(`Error creating health score decrease alert:`, error);
    }
  }

  private async scheduleNextMonthlyHealthCheck(): Promise<void> {
    try {
      const waitingJobs = await this.healthQueue.getWaiting();
      const existingMonthlyCheckJob = waitingJobs.find(job => job.name === 'monthly-health-check');
      
      if (existingMonthlyCheckJob) {
        this.logger.log('📅 Monthly health check job already scheduled, skipping duplicate');
        return;
      }

      const now = new Date();
      const nextMonth = new Date(now);
      nextMonth.setMonth(nextMonth.getMonth() + 2);
      nextMonth.setHours(0, 0, 0, 0);
      
      const delayMs = nextMonth.getTime() - now.getTime();
      
      await this.healthQueue.add(
        'monthly-health-check',
        {},
        {
          delay: delayMs,
          attempts: 1,
          removeOnComplete: 10,
          removeOnFail: 50,
        },
      );

      this.logger.log(`📅 Scheduled next monthly health check for ${nextMonth.toISOString()}`);
    } catch (error) {
      this.logger.error('Error scheduling next monthly health check:', error);
    }
  }

  private async initializeMonthlyHealthCheck(): Promise<void> {
    try {
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

      if (!watchlist?.package) {
        this.logger.error(`No package found for watchlist ${watchlistId}`);
        return;
      }

      const { repo_url, repo_name } = watchlist.package;
      const { default_branch } = watchlist;
      
      if (!repo_url || !default_branch) {
        this.logger.error(`Missing repo URL or default branch for watchlist ${watchlistId}`);
        return;
      }

      const urlParts = repo_url.split('/');
      const owner = urlParts[urlParts.length - 2];
      const repo = urlParts[urlParts.length - 1];

      await this.checkRepositoryHealth(watchlistId, owner, repo, default_branch, repo_name);
    } catch (error) {
      this.logger.error(`Error in single repository health check for ${watchlistId}:`, error);
    }
  }
}
