import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';

interface AlertConfig {
  lines_added_deleted?: {
    enabled: boolean;
    contributor_variance: number;
    repository_variance: number;
    hardcoded_threshold: number;
  };
  files_changed?: {
    enabled: boolean;
    contributor_variance: number;
    repository_variance: number;
    hardcoded_threshold: number;
  };
  high_churn?: {
    enabled: boolean;
    multiplier: number;
    hardcoded_threshold: number;
  };
  ancestry_breaks?: {
    enabled: boolean;
  };
  unusual_author_activity?: {
    enabled: boolean;
    percentage_outside_range: number;
  };
}

interface CommitData {
  sha: string;
  author: string;
  email: string;
  message: string;
  date: Date;
  linesAdded?: number;
  linesDeleted?: number;
  filesChanged?: string[];
}

@Injectable()
export class AlertingService {
  private readonly logger = new Logger(AlertingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Check a commit against all user alert thresholds for a watchlist
   */
  async checkCommitForAlerts(watchlistId: string, commitData: CommitData): Promise<void> {
    try {
      this.logger.log(`🔍 Checking commit ${commitData.sha} for alerts in watchlist ${watchlistId}`);

      // Get all users watching this repository
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

      // Get repository and contributor statistics for comparison
      const repoStats = await this.prisma.repoStats.findUnique({
        where: { watchlist_id: watchlistId },
      });

      const contributorStats = await this.prisma.contributorStats.findUnique({
        where: {
          watchlist_id_author_email: {
            watchlist_id: watchlistId,
            author_email: commitData.email,
          },
        },
      });

      // Check each user's alert thresholds
      for (const userWatchlist of userWatchlists) {
        await this.checkUserAlerts(
          userWatchlist,
          watchlistId,
          commitData,
          repoStats,
          contributorStats,
        );
      }

      this.logger.log(`✅ Alert checking completed for commit ${commitData.sha}`);
    } catch (error) {
      this.logger.error(`Error checking alerts for commit ${commitData.sha}:`, error);
    }
  }

  /**
   * Check a specific user's alert thresholds against a commit
   */
  private async checkUserAlerts(
    userWatchlist: { id: string; user_id: string; alerts: string | null },
    watchlistId: string,
    commitData: CommitData,
    repoStats: any,
    contributorStats: any,
  ): Promise<void> {
    try {
      // Parse user's alert configuration
      const alertConfig = this.parseAlertConfig(userWatchlist.alerts);
      if (!alertConfig) {
        return; // No alerts configured
      }

      // Check lines added/deleted alerts
      if (alertConfig.lines_added_deleted?.enabled) {
        await this.checkLinesAddedDeletedAlert(
          userWatchlist.id,
          watchlistId,
          commitData,
          alertConfig.lines_added_deleted,
          repoStats,
          contributorStats,
        );
      }

      // Check files changed alerts
      if (alertConfig.files_changed?.enabled) {
        await this.checkFilesChangedAlert(
          userWatchlist.id,
          watchlistId,
          commitData,
          alertConfig.files_changed,
          repoStats,
          contributorStats,
        );
      }

      // Check high churn alerts
      if (alertConfig.high_churn?.enabled) {
        await this.checkHighChurnAlert(
          userWatchlist.id,
          watchlistId,
          commitData,
          alertConfig.high_churn,
          repoStats,
          contributorStats,
        );
      }

      // Check unusual author activity
      if (alertConfig.unusual_author_activity?.enabled) {
        await this.checkUnusualAuthorActivityAlert(
          userWatchlist.id,
          watchlistId,
          commitData,
          alertConfig.unusual_author_activity,
          contributorStats,
        );
      }

      // Note: ancestry_breaks would require more complex git analysis
      // and is not implemented in this basic version

    } catch (error) {
      this.logger.error(`Error checking alerts for user ${userWatchlist.user_id}:`, error);
    }
  }

  /**
   * Parse user's alert configuration from JSON string
   */
  private parseAlertConfig(alertsJson: string | null): AlertConfig | null {
    if (!alertsJson) {
      return null;
    }

    try {
      const config = JSON.parse(alertsJson);
      return config as AlertConfig;
    } catch (error) {
      this.logger.error(`Error parsing alert config: ${error.message}`);
      return null;
    }
  }

  /**
   * Check lines added/deleted alerts
   */
  private async checkLinesAddedDeletedAlert(
    userWatchlistId: string,
    watchlistId: string,
    commitData: CommitData,
    config: AlertConfig['lines_added_deleted'],
    repoStats: any,
    contributorStats: any,
  ): Promise<void> {
    if (!config) return;

    const totalLines = (commitData.linesAdded || 0) + (commitData.linesDeleted || 0);
    
    // Check hardcoded threshold
    if (totalLines > config.hardcoded_threshold) {
      await this.createAlert(
        userWatchlistId,
        watchlistId,
        commitData,
        'lines_added_deleted',
        'hardcoded_threshold',
        totalLines,
        config.hardcoded_threshold,
        `Total lines changed (${totalLines}) exceeds hardcoded threshold (${config.hardcoded_threshold})`,
      );
    }

    // Check contributor variance
    if (contributorStats && config.contributor_variance > 0) {
      const contributorAvg = contributorStats.avg_lines_added + contributorStats.avg_lines_deleted;
      const contributorThreshold = contributorAvg + (config.contributor_variance * 
        Math.sqrt(contributorStats.stddev_lines_added ** 2 + contributorStats.stddev_lines_deleted ** 2));
      
      if (totalLines > contributorThreshold) {
        await this.createAlert(
          userWatchlistId,
          watchlistId,
          commitData,
          'lines_added_deleted',
          'contributor_variance',
          totalLines,
          contributorThreshold,
          `Total lines changed (${totalLines}) exceeds contributor's normal range (${contributorThreshold.toFixed(1)})`,
        );
      }
    }

    // Check repository variance
    if (repoStats && config.repository_variance > 0) {
      const repoAvg = repoStats.avg_lines_added + repoStats.avg_lines_deleted;
      const repoThreshold = repoAvg * config.repository_variance;
      
      if (totalLines > repoThreshold) {
        await this.createAlert(
          userWatchlistId,
          watchlistId,
          commitData,
          'lines_added_deleted',
          'repository_variance',
          totalLines,
          repoThreshold,
          `Total lines changed (${totalLines}) exceeds repository average by ${config.repository_variance}x (${repoThreshold.toFixed(1)})`,
        );
      }
    }
  }

  /**
   * Check files changed alerts
   */
  private async checkFilesChangedAlert(
    userWatchlistId: string,
    watchlistId: string,
    commitData: CommitData,
    config: AlertConfig['files_changed'],
    repoStats: any,
    contributorStats: any,
  ): Promise<void> {
    if (!config) return;

    const filesChanged = commitData.filesChanged?.length || 0;
    
    // Check hardcoded threshold
    if (filesChanged > config.hardcoded_threshold) {
      await this.createAlert(
        userWatchlistId,
        watchlistId,
        commitData,
        'files_changed',
        'hardcoded_threshold',
        filesChanged,
        config.hardcoded_threshold,
        `Files changed (${filesChanged}) exceeds hardcoded threshold (${config.hardcoded_threshold})`,
      );
    }

    // Check contributor variance
    if (contributorStats && config.contributor_variance > 0) {
      const contributorThreshold = contributorStats.avg_files_changed + 
        (config.contributor_variance * contributorStats.stddev_files_changed);
      
      if (filesChanged > contributorThreshold) {
        await this.createAlert(
          userWatchlistId,
          watchlistId,
          commitData,
          'files_changed',
          'contributor_variance',
          filesChanged,
          contributorThreshold,
          `Files changed (${filesChanged}) exceeds contributor's normal range (${contributorThreshold.toFixed(1)})`,
        );
      }
    }

    // Check repository variance
    if (repoStats && config.repository_variance > 0) {
      const repoThreshold = repoStats.avg_files_changed * config.repository_variance;
      
      if (filesChanged > repoThreshold) {
        await this.createAlert(
          userWatchlistId,
          watchlistId,
          commitData,
          'files_changed',
          'repository_variance',
          filesChanged,
          repoThreshold,
          `Files changed (${filesChanged}) exceeds repository average by ${config.repository_variance}x (${repoThreshold.toFixed(1)})`,
        );
      }
    }
  }

  /**
   * Check high churn alerts
   */
  private async checkHighChurnAlert(
    userWatchlistId: string,
    watchlistId: string,
    commitData: CommitData,
    config: AlertConfig['high_churn'],
    repoStats: any,
    contributorStats: any,
  ): Promise<void> {
    if (!config) return;

    const totalLines = (commitData.linesAdded || 0) + (commitData.linesDeleted || 0);
    const filesChanged = commitData.filesChanged?.length || 0;
    
    // High churn = high lines changed relative to files changed
    if (filesChanged > 0) {
      const churnRatio = totalLines / filesChanged;
      
      // Check hardcoded threshold
      if (churnRatio > config.hardcoded_threshold) {
        await this.createAlert(
          userWatchlistId,
          watchlistId,
          commitData,
          'high_churn',
          'hardcoded_threshold',
          churnRatio,
          config.hardcoded_threshold,
          `High churn ratio (${churnRatio.toFixed(1)} lines/file) exceeds threshold (${config.hardcoded_threshold})`,
        );
      }

      // Check multiplier against repository average
      if (repoStats && config.multiplier > 0) {
        const repoChurnRatio = (repoStats.avg_lines_added + repoStats.avg_lines_deleted) / repoStats.avg_files_changed;
        const multiplierThreshold = repoChurnRatio * config.multiplier;
        
        if (churnRatio > multiplierThreshold) {
          await this.createAlert(
            userWatchlistId,
            watchlistId,
            commitData,
            'high_churn',
            'multiplier',
            churnRatio,
            multiplierThreshold,
            `High churn ratio (${churnRatio.toFixed(1)}) exceeds repository average by ${config.multiplier}x (${multiplierThreshold.toFixed(1)})`,
          );
        }
      }
    }
  }

  /**
   * Check unusual author activity alerts
   */
  private async checkUnusualAuthorActivityAlert(
    userWatchlistId: string,
    watchlistId: string,
    commitData: CommitData,
    config: AlertConfig['unusual_author_activity'],
    contributorStats: any,
  ): Promise<void> {
    if (!config || !contributorStats) return;

    // Check if commit time is outside contributor's typical hours
    const commitHour = commitData.date.getHours();
    const timeHistogram = contributorStats.commit_time_histogram as Record<string, number>;
    
    if (timeHistogram) {
      const totalCommits = Object.values(timeHistogram).reduce((sum, count) => sum + count, 0);
      const commitsAtHour = timeHistogram[commitHour.toString()] || 0;
      const percentageAtHour = (commitsAtHour / totalCommits) * 100;
      
      if (percentageAtHour < config.percentage_outside_range) {
        await this.createAlert(
          userWatchlistId,
          watchlistId,
          commitData,
          'unusual_author_activity',
          'percentage_outside_range',
          percentageAtHour,
          config.percentage_outside_range,
          `Commit at ${commitHour}:00 (${percentageAtHour.toFixed(1)}% of contributor's activity) is unusual`,
        );
      }
    }
  }

  /**
   * Create an alert in the AlertTriggered table
   */
  private async createAlert(
    userWatchlistId: string,
    watchlistId: string,
    commitData: CommitData,
    metric: string,
    thresholdType: string,
    value: number,
    threshold: number,
    description: string,
  ): Promise<void> {
    try {
      const details = {
        commit: {
          sha: commitData.sha,
          author: commitData.author,
          email: commitData.email,
          message: commitData.message,
          date: commitData.date.toISOString(),
          linesAdded: commitData.linesAdded,
          linesDeleted: commitData.linesDeleted,
          filesChanged: commitData.filesChanged,
        },
        threshold: {
          metric,
          thresholdType,
          thresholdValue: threshold,
          actualValue: value,
        },
      };

      await this.prisma.alertTriggered.create({
        data: {
          user_watchlist_id: userWatchlistId,
          watchlist_id: watchlistId,
          commit_sha: commitData.sha,
          contributor: commitData.author,
          metric,
          value,
          alert_level: 'moderate', // Default level since schema doesn't have specific levels
          threshold_type: thresholdType,
          threshold_value: threshold,
          description,
          details_json: details,
        },
      });

      this.logger.log(
        `🚨 ALERT CREATED: ${metric} - ${commitData.author} - ${description}`,
      );
    } catch (error) {
      this.logger.error(`Error creating alert:`, error);
    }
  }
} 