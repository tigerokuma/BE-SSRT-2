import { Injectable } from '@nestjs/common';
import { WatchlistRepository } from '../repositories/watchlist.repository';
import {
  AddToWatchlistRequest,
  UpdateWatchlistRequest,
} from '../dto/watchlist.dto';
import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class WatchlistService {
  constructor(
    private readonly watchlistRepository: WatchlistRepository,
    private readonly prisma: PrismaService,
  ) {}

  async getWatchlist(userId?: string) {
    // Get user's watchlist items with package details and enriched data
    const userWatchlist = await this.watchlistRepository.getWatchlist(userId);
    
    // Transform the data to match frontend expectations
    return userWatchlist.map(item => ({
      id: item.id,
      watchlist_id: item.watchlist.watchlist_id, // Add watchlist_id for status checking
      name: item.watchlist.package.package_name,
      repo_url: item.watchlist.package.repo_url,
      description: item.enhancedDescription || item.watchlist.package.description, // Use enhanced description if available
      version: item.watchlist.package.version,
      downloads: item.downloads, // Use enriched data from repository
      stars: item.stars, // Use enriched data from repository
      forks: item.forks, // Use enriched data from repository
      contributors: item.contributors, // Use enriched data from repository
      npm_url: item.npmUrl, // NPM URL from npm_packages table
      risk_score: item.watchlist.package.risk_score,
      last_updated: item.watchlist.package.last_updated,
      notes: item.notes,
      alerts: item.alerts ? JSON.parse(item.alerts) : null,
      added_at: item.added_at,
      status: item.watchlist.status, // This is already the status from the database!
      processing_started_at: item.watchlist.processing_started_at,
      processing_completed_at: item.watchlist.processing_completed_at,
      last_error: item.watchlist.last_error,
      // New enriched data fields
      notification_count: item.alertCount || 0, // Number of alerts triggered
      activity_score: item.activityScore || null, // Activity score from ActivityData
      bus_factor: item.busFactor || null, // Bus factor from BusFactorData
      health_score: item.healthScore || null, // Health score from HealthData
      tracking_duration: item.trackingDuration || '0 days', // How long tracking
      // AI summary data
      ai_summary: item.aiSummary || null,
      ai_confidence: item.aiConfidence || null,
      ai_model_used: item.aiModelUsed || null,
      ai_created_at: item.aiCreatedAt || null
    }));
  }

  async getWatchlistItemDetails(userWatchlistId: string) {
    // Get a specific watchlist item by user watchlist ID
    const userWatchlist = await this.watchlistRepository.getWatchlist();
    const item = userWatchlist.find(item => item.id === userWatchlistId);
    
    if (!item) {
      throw new Error('Watchlist item not found');
    }

    // Get health history data with scorecard metrics
    const healthHistory = await this.prisma.healthData.findMany({
      where: {
        watchlist_id: item.watchlist.watchlist_id
      },
      orderBy: {
        analysis_date: 'asc'
      },
      select: {
        overall_health_score: true,
        analysis_date: true,
        commit_sha: true,
        commit_date: true,
        scorecard_metrics: true
      }
    });

    // Get latest scorecard data
    const latestHealthData = await this.prisma.healthData.findFirst({
      where: {
        watchlist_id: item.watchlist.watchlist_id
      },
      orderBy: {
        analysis_date: 'desc'
      },
      select: {
        overall_health_score: true,
        analysis_date: true,
        commit_sha: true,
        commit_date: true,
        scorecard_metrics: true
      }
    });

    // Transform health history to frontend format
    const transformedHealthHistory = healthHistory.map(health => ({
      date: health.commit_date ? health.commit_date.toISOString().split('T')[0] : health.analysis_date.toISOString().split('T')[0],
      score: Number(health.overall_health_score),
      commitSha: health.commit_sha
    }));

    // Transform scorecard data for each health history point
    const transformedScorecardData = healthHistory
      .filter(health => health.scorecard_metrics) // Only include entries with scorecard data
      .map(health => {
        const scorecardMetrics = health.scorecard_metrics as any;
        return {
          date: health.commit_date ? health.commit_date.toISOString().split('T')[0] : health.analysis_date.toISOString().split('T')[0],
          score: Number(health.overall_health_score),
          commitSha: health.commit_sha,
          checks: scorecardMetrics.checks || []
        };
      });

    // Transform scorecard data
    let scorecardHealth: any = null;
    if (latestHealthData && latestHealthData.scorecard_metrics) {
      const scorecardMetrics = latestHealthData.scorecard_metrics as any;
      scorecardHealth = {
        date: latestHealthData.commit_date ? latestHealthData.commit_date.toISOString().split('T')[0] : latestHealthData.analysis_date.toISOString().split('T')[0],
        score: Number(latestHealthData.overall_health_score),
        commitSha: latestHealthData.commit_sha,
        checks: scorecardMetrics.checks || []
      };
    }
    
    // Return the same structure as getWatchlist but for a single item
    return {
      id: item.id,
      watchlist_id: item.watchlist.watchlist_id,
      name: item.watchlist.package.package_name,
      repo_url: item.watchlist.package.repo_url,
      description: item.enhancedDescription || item.watchlist.package.description, // Use enhanced description if available
      version: item.watchlist.package.version,
      downloads: item.downloads,
      stars: item.stars,
      forks: item.forks,
      contributors: item.contributors,
      npm_url: item.npmUrl, // NPM URL from npm_packages table
      risk_score: item.watchlist.package.risk_score,
      last_updated: item.watchlist.package.last_updated,
      notes: item.notes,
      alerts: item.alerts ? JSON.parse(item.alerts) : null,
      added_at: item.added_at,
      status: item.watchlist.status,
      processing_started_at: item.watchlist.processing_started_at,
      processing_completed_at: item.watchlist.processing_completed_at,
      last_error: item.watchlist.last_error,
      notification_count: item.alertCount || 0,
      activity_score: item.activityScore || null,
      activity_factors: item.activityFactors || null,
      weekly_commit_rate: item.weeklyCommitRate || null,
      activity_heatmap: item.activityHeatmap || null,
      bus_factor: item.busFactor || null,
      health_score: item.healthScore || null,
      tracking_duration: item.trackingDuration || '0 days',
      // AI summary data
      ai_summary: item.aiSummary || null,
      ai_confidence: item.aiConfidence || null,
      ai_model_used: item.aiModelUsed || null,
      ai_created_at: item.aiCreatedAt || null,
      // Health data
      health_history: transformedHealthHistory,
      scorecard_health: transformedScorecardData.length > 0 ? transformedScorecardData : scorecardHealth
    };
  }

  async addToWatchlist(request: AddToWatchlistRequest) {
    // TODO: Implement data access for adding to watchlist
    // - Insert new watchlist item in database
    // - Handle duplicate prevention
    // - Return created item
    throw new Error('Not implemented');
  }

  async updateWatchlistItem(id: string, request: UpdateWatchlistRequest) {
    // TODO: Implement data access for watchlist item update
    // - Update existing watchlist item in database
    // - Return updated item
    throw new Error('Not implemented');
  }

  async importFromGithub(repoUrl: string) {
    // TODO: Implement data access for GitHub import
    // - Bulk insert watchlist items
    // - Handle conflicts with existing items
    // - Return import results
    throw new Error('Not implemented');
  }
}
