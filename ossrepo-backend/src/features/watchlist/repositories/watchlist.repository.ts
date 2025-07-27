import { Injectable } from '@nestjs/common';
import {
  AddToWatchlistRequest,
  UpdateWatchlistRequest,
} from '../dto/watchlist.dto';
import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class WatchlistRepository {
  constructor(private readonly prisma: PrismaService) {} // Injects PrismaService

  async getWatchlist(userId: string = 'user-123') {
    // Fetch user's watchlist items with package details
    const userWatchlist = await this.prisma.userWatchlist.findMany({
      where: {
        user_id: userId
      },
      include: {
        watchlist: {
          include: {
            package: true
          }
        }
      },
      orderBy: {
        added_at: 'desc'
      }
    });

    // Fetch additional data for each watchlist item
    const enrichedWatchlist = await Promise.all(
      userWatchlist.map(async (item) => {
        // Get alert count for this user watchlist
        const alertCount = await this.prisma.alertTriggered.count({
          where: {
            user_watchlist_id: item.id
          }
        });

        // Get latest activity score
        const latestActivity = await this.prisma.activityData.findFirst({
          where: {
            watchlist_id: item.watchlist_id
          },
          orderBy: {
            analysis_date: 'desc'
          },
          select: {
            activity_score: true,
            activity_factors: true,
            weekly_commit_rate: true,
            activity_heatmap: true
          }
        });

        // Get latest bus factor data
        const latestBusFactor = await this.prisma.busFactorData.findFirst({
          where: {
            watchlist_id: item.watchlist_id
          },
          orderBy: {
            analysis_date: 'desc'
          },
          select: {
            bus_factor: true
          }
        });

        // Get latest health score
        const latestHealth = await this.prisma.healthData.findFirst({
          where: {
            watchlist_id: item.watchlist_id
          },
          orderBy: {
            analysis_date: 'desc'
          },
          select: {
            overall_health_score: true
          }
        });

        // Get latest AI summary
        const latestAISummary = await this.prisma.aISummaryData.findFirst({
          where: {
            watchlist_id: item.watchlist_id
          },
          orderBy: {
            created_at: 'desc'
          },
          select: {
            summary: true,
            confidence: true,
            model_used: true,
            created_at: true
          }
        });

        // Calculate tracking duration
        const trackingDuration = this.calculateTrackingDuration(item.added_at);

        // --- Enhanced: Fetch comprehensive data from npm_packages and github_repositories ---
        let downloads: number | null = null;
        let stars: number | null = null;
        let contributors: number | null = null;
        let forks: number | null = null;
        let npmUrl: string | null = null;
        let enhancedDescription: string | null = null;
        let repoUrl = item.watchlist.package?.repo_url;
        
        if (repoUrl) {
          // Ensure repoUrl starts with 'https://'
          if (!repoUrl.startsWith('http://') && !repoUrl.startsWith('https://')) {
            repoUrl = 'https://' + repoUrl;
          }

          // Enhanced NPM data fetch
          const npmPkg = await this.prisma.npmPackage.findFirst({
            where: { repo_url: repoUrl },
            select: { 
              downloads: true,
              npm_url: true,
              description: true
            }
          });
          downloads = npmPkg?.downloads ?? null;
          npmUrl = npmPkg?.npm_url ?? null;
          enhancedDescription = npmPkg?.description ?? null;

          // GitHub stars, contributors, forks
          const ghRepo = await this.prisma.gitHubRepository.findUnique({
            where: { repo_url: repoUrl },
            select: { stars: true, contributors: true, forks: true }
          });
          stars = ghRepo?.stars ?? null;
          contributors = ghRepo?.contributors ?? null;
          forks = ghRepo?.forks ?? null;
        }
        // --- End enhanced ---

        return {
          ...item,
          alertCount,
          activityScore: latestActivity?.activity_score || null,
          activityFactors: latestActivity?.activity_factors || null,
          weeklyCommitRate: latestActivity?.weekly_commit_rate || null,
          activityHeatmap: latestActivity?.activity_heatmap || null,
          busFactor: latestBusFactor?.bus_factor || null,
          healthScore: latestHealth?.overall_health_score || null,
          trackingDuration,
          // Enhanced data fields for frontend
          downloads,
          stars,
          contributors,
          forks,
          npmUrl,
          enhancedDescription,
          // AI summary data
          aiSummary: latestAISummary?.summary || null,
          aiConfidence: latestAISummary?.confidence || null,
          aiModelUsed: latestAISummary?.model_used || null,
          aiCreatedAt: latestAISummary?.created_at || null
        };
      })
    );

    return enrichedWatchlist;
  }

  private calculateTrackingDuration(addedAt: Date): string {
    const now = new Date();
    const diffInMs = now.getTime() - addedAt.getTime();
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
    
    if (diffInDays < 30) {
      return `${diffInDays} days`;
    } else if (diffInDays < 365) {
      const months = Math.floor(diffInDays / 30);
      return `${months} month${months > 1 ? 's' : ''}`;
    } else {
      const years = Math.floor(diffInDays / 365);
      return `${years} year${years > 1 ? 's' : ''}`;
    }
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

  async deleteWatchlistItem(id: string) {
    // TODO: Implement data access for watchlist item deletion
    // - Remove item from database
    // - Return success status
    throw new Error('Not implemented');
  }
}
