import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';

interface AlertThreshold {
  metric: string;
  threshold: number;
  thresholdType: 'contributor_stddev' | 'repo_average' | 'absolute' | 'user_defined';
  alertLevel: 'mild' | 'moderate' | 'critical';
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
      if (!alertConfig || alertConfig.length === 0) {
        return; // No alerts configured
      }

      // Check each threshold
      for (const threshold of alertConfig) {
        const shouldAlert = await this.checkThreshold(
          threshold,
          commitData,
          repoStats,
          contributorStats,
        );

        if (shouldAlert) {
          await this.createAlert(
            userWatchlist.id,
            watchlistId,
            commitData,
            threshold,
            repoStats,
            contributorStats,
          );
        }
      }
    } catch (error) {
      this.logger.error(`Error checking alerts for user ${userWatchlist.user_id}:`, error);
    }
  }

  /**
   * Parse user's alert configuration from JSON string
   */
  private parseAlertConfig(alertsJson: string | null): AlertThreshold[] {
    if (!alertsJson) {
      return [];
    }

    try {
      const config = JSON.parse(alertsJson);
      return Array.isArray(config) ? config : [];
    } catch (error) {
      this.logger.error(`Error parsing alert config: ${error.message}`);
      return [];
    }
  }

  /**
   * Check if a commit meets a specific threshold
   */
  private async checkThreshold(
    threshold: AlertThreshold,
    commitData: CommitData,
    repoStats: any,
    contributorStats: any,
  ): Promise<boolean> {
    const { metric, thresholdType, threshold: thresholdValue } = threshold;

    let actualValue: number = 0;
    let comparisonValue: number = 0;

    // Get the actual value from the commit
    switch (metric) {
      case 'lines_added':
        actualValue = commitData.linesAdded || 0;
        break;
      case 'lines_deleted':
        actualValue = commitData.linesDeleted || 0;
        break;
      case 'files_changed':
        actualValue = commitData.filesChanged?.length || 0;
        break;
      case 'commit_time':
        // Check if commit is outside normal hours (e.g., between 2 AM and 6 AM)
        const hour = commitData.date.getHours();
        actualValue = hour >= 2 && hour <= 6 ? 1 : 0;
        break;
      default:
        return false;
    }

    // Get the comparison value based on threshold type
    switch (thresholdType) {
      case 'absolute':
        comparisonValue = thresholdValue;
        break;
      case 'repo_average':
        if (!repoStats) return false;
        switch (metric) {
          case 'lines_added':
            comparisonValue = repoStats.avg_lines_added;
            break;
          case 'lines_deleted':
            comparisonValue = repoStats.avg_lines_deleted;
            break;
          case 'files_changed':
            comparisonValue = repoStats.avg_files_changed;
            break;
        }
        break;
      case 'contributor_stddev':
        if (!contributorStats) return false;
        const avg = this.getContributorAverage(contributorStats, metric);
        const stddev = this.getContributorStddev(contributorStats, metric);
        comparisonValue = avg + (thresholdValue * stddev);
        break;
      case 'user_defined':
        comparisonValue = thresholdValue;
        break;
    }

    // Check if the actual value exceeds the threshold
    return actualValue > comparisonValue;
  }

  /**
   * Get contributor average for a specific metric
   */
  private getContributorAverage(contributorStats: any, metric: string): number {
    switch (metric) {
      case 'lines_added':
        return contributorStats.avg_lines_added || 0;
      case 'lines_deleted':
        return contributorStats.avg_lines_deleted || 0;
      case 'files_changed':
        return contributorStats.avg_files_changed || 0;
      default:
        return 0;
    }
  }

  /**
   * Get contributor standard deviation for a specific metric
   */
  private getContributorStddev(contributorStats: any, metric: string): number {
    switch (metric) {
      case 'lines_added':
        return contributorStats.stddev_lines_added || 0;
      case 'lines_deleted':
        return contributorStats.stddev_lines_deleted || 0;
      case 'files_changed':
        return contributorStats.stddev_files_changed || 0;
      default:
        return 0;
    }
  }

  /**
   * Create an alert in the AlertTriggered table
   */
  private async createAlert(
    userWatchlistId: string,
    watchlistId: string,
    commitData: CommitData,
    threshold: AlertThreshold,
    repoStats: any,
    contributorStats: any,
  ): Promise<void> {
    try {
      const description = this.generateAlertDescription(
        threshold,
        commitData,
        repoStats,
        contributorStats,
      );

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
          metric: threshold.metric,
          thresholdType: threshold.thresholdType,
          thresholdValue: threshold.threshold,
          alertLevel: threshold.alertLevel,
        },
        context: {
          repoStats: repoStats ? {
            avgLinesAdded: repoStats.avg_lines_added,
            avgLinesDeleted: repoStats.avg_lines_deleted,
            avgFilesChanged: repoStats.avg_files_changed,
          } : null,
          contributorStats: contributorStats ? {
            avgLinesAdded: contributorStats.avg_lines_added,
            avgLinesDeleted: contributorStats.avg_lines_deleted,
            avgFilesChanged: contributorStats.avg_files_changed,
            stddevLinesAdded: contributorStats.stddev_lines_added,
            stddevLinesDeleted: contributorStats.stddev_lines_deleted,
            stddevFilesChanged: contributorStats.stddev_files_changed,
          } : null,
        },
      };

      await this.prisma.alertTriggered.create({
        data: {
          user_watchlist_id: userWatchlistId,
          watchlist_id: watchlistId,
          commit_sha: commitData.sha,
          contributor: commitData.author,
          metric: threshold.metric,
          value: this.getCommitValue(commitData, threshold.metric),
          alert_level: threshold.alertLevel,
          threshold_type: threshold.thresholdType,
          threshold_value: threshold.threshold,
          description,
          details_json: details,
        },
      });

      this.logger.log(
        `🚨 ALERT CREATED: ${threshold.alertLevel.toUpperCase()} - ${commitData.author} - ${threshold.metric}: ${this.getCommitValue(commitData, threshold.metric)}`,
      );
    } catch (error) {
      this.logger.error(`Error creating alert:`, error);
    }
  }

  /**
   * Get the numeric value for a specific metric from commit data
   */
  private getCommitValue(commitData: CommitData, metric: string): number {
    switch (metric) {
      case 'lines_added':
        return commitData.linesAdded || 0;
      case 'lines_deleted':
        return commitData.linesDeleted || 0;
      case 'files_changed':
        return commitData.filesChanged?.length || 0;
      case 'commit_time':
        const hour = commitData.date.getHours();
        return hour >= 2 && hour <= 6 ? 1 : 0;
      default:
        return 0;
    }
  }

  /**
   * Generate a human-readable alert description
   */
  private generateAlertDescription(
    threshold: AlertThreshold,
    commitData: CommitData,
    repoStats: any,
    contributorStats: any,
  ): string {
    const value = this.getCommitValue(commitData, threshold.metric);
    const metricName = this.getMetricDisplayName(threshold.metric);

    switch (threshold.thresholdType) {
      case 'absolute':
        return `${commitData.author} made ${value} ${metricName} (exceeds absolute threshold of ${threshold.threshold})`;
      
      case 'repo_average':
        const repoAvg = this.getRepoAverage(repoStats, threshold.metric);
        return `${commitData.author} made ${value} ${metricName} (exceeds repository average of ${repoAvg.toFixed(1)})`;
      
      case 'contributor_stddev':
        const contributorAvg = this.getContributorAverage(contributorStats, threshold.metric);
        const stddev = this.getContributorStddev(contributorStats, threshold.metric);
        return `${commitData.author} made ${value} ${metricName} (exceeds personal average of ${contributorAvg.toFixed(1)} + ${threshold.threshold}σ)`;
      
      case 'user_defined':
        return `${commitData.author} made ${value} ${metricName} (exceeds user-defined threshold of ${threshold.threshold})`;
      
      default:
        return `${commitData.author} triggered ${threshold.metric} alert`;
    }
  }

  /**
   * Get display name for a metric
   */
  private getMetricDisplayName(metric: string): string {
    switch (metric) {
      case 'lines_added':
        return 'lines added';
      case 'lines_deleted':
        return 'lines deleted';
      case 'files_changed':
        return 'files changed';
      case 'commit_time':
        return 'commits during unusual hours';
      default:
        return metric;
    }
  }

  /**
   * Get repository average for a specific metric
   */
  private getRepoAverage(repoStats: any, metric: string): number {
    if (!repoStats) return 0;
    
    switch (metric) {
      case 'lines_added':
        return repoStats.avg_lines_added || 0;
      case 'lines_deleted':
        return repoStats.avg_lines_deleted || 0;
      case 'files_changed':
        return repoStats.avg_files_changed || 0;
      default:
        return 0;
    }
  }
} 