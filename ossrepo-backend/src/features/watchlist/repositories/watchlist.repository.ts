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
        user_id: userId,
      },
      include: {
        watchlist: {
          include: {
            package: true,
          },
        },
      },
      orderBy: {
        added_at: 'desc',
      },
    });

    // Fetch additional data for each watchlist item
    const enrichedWatchlist = await Promise.all(
      userWatchlist.map(async (item) => {
        // Get alert count for this user watchlist
        const alertCount = await this.prisma.alertTriggered.count({
          where: {
            user_watchlist_id: item.id,
          },
        });

        // Get latest activity score
        const latestActivity = await this.prisma.activityData.findFirst({
          where: {
            watchlist_id: item.watchlist_id,
          },
          orderBy: {
            analysis_date: 'desc',
          },
          select: {
            activity_score: true,
            activity_factors: true,
            weekly_commit_rate: true,
            activity_heatmap: true,
          },
        });

        // Get latest bus factor data
        const latestBusFactor = await this.prisma.busFactorData.findFirst({
          where: {
            watchlist_id: item.watchlist_id,
          },
          orderBy: {
            analysis_date: 'desc',
          },
          select: {
            bus_factor: true,
            total_contributors: true,
            total_commits: true,
            top_contributors: true,
            risk_level: true,
            risk_reason: true,
            analysis_date: true,
          },
        });

        // Get latest health score
        const latestHealth = await this.prisma.healthData.findFirst({
          where: {
            watchlist_id: item.watchlist_id,
          },
          orderBy: {
            analysis_date: 'desc',
          },
          select: {
            overall_health_score: true,
          },
        });

        // Get latest AI summary
        const latestAISummary = await this.prisma.aISummaryData.findFirst({
          where: {
            watchlist_id: item.watchlist_id,
          },
          orderBy: {
            created_at: 'desc',
          },
          select: {
            summary: true,
            confidence: true,
            model_used: true,
            created_at: true,
          },
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
          if (
            !repoUrl.startsWith('http://') &&
            !repoUrl.startsWith('https://')
          ) {
            repoUrl = 'https://' + repoUrl;
          }

          // Enhanced NPM data fetch
          const npmPkg = await this.prisma.npmPackage.findFirst({
            where: { repo_url: repoUrl },
            select: {
              downloads: true,
              npm_url: true,
              description: true,
            },
          });
          downloads = npmPkg?.downloads ?? null;
          npmUrl = npmPkg?.npm_url ?? null;
          enhancedDescription = npmPkg?.description ?? null;

          // GitHub stars, contributors, forks
          const ghRepo = await this.prisma.gitHubRepository.findUnique({
            where: { repo_url: repoUrl },
            select: { stars: true, contributors: true, forks: true },
          });
          stars = ghRepo?.stars ?? null;
          contributors = ghRepo?.contributors ?? null;
          forks = ghRepo?.forks ?? null;
        }
        // --- End enhanced ---

        return {
          ...item,
          alertCount,
          activityScore:
            latestActivity?.activity_score !== undefined &&
            latestActivity?.activity_score !== null
              ? latestActivity.activity_score
              : null,
          activityFactors: latestActivity?.activity_factors || null,
          weeklyCommitRate: latestActivity?.weekly_commit_rate || null,
          activityHeatmap: latestActivity?.activity_heatmap || null,
          busFactor: latestBusFactor?.bus_factor || null,
          busFactorDetails: latestBusFactor
            ? {
                level: latestBusFactor.bus_factor,
                risk: latestBusFactor.risk_level as
                  | 'LOW'
                  | 'MEDIUM'
                  | 'HIGH'
                  | 'CRITICAL',
                description: latestBusFactor.risk_reason || '',
                topContributors:
                  (latestBusFactor.top_contributors as any[]) || [],
                totalContributors: latestBusFactor.total_contributors || 0,
                totalCommits: latestBusFactor.total_commits || 0,
                analysisDate: latestBusFactor.analysis_date,
              }
            : null,
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
          aiCreatedAt: latestAISummary?.created_at || null,
        };
      }),
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

  async addToWatchlist(user_id: string, request: AddToWatchlistRequest) {
    // Try to find the package in the Package table
    let pkg = await this.prisma.package.findUnique({
      where: { package_name: request.name },
    });
    // If not found, try to import from NpmPackage
    if (!pkg) {
      const npmPkg = await this.prisma.npmPackage.findUnique({
        where: { package_name: request.name },
      });
      if (!npmPkg) throw new Error('Package not found');
      // Create a new Package record from NpmPackage fields
      pkg = await this.prisma.package.create({
        data: {
          package_name: npmPkg.package_name,
          description: npmPkg.description,
          version: npmPkg.version,
          downloads: npmPkg.downloads,
          keywords: npmPkg.keywords,
          license: npmPkg.license,
          npm_url: npmPkg.npm_url,
          homepage: npmPkg.homepage,
          published_at: npmPkg.published_at,
          last_updated: npmPkg.last_updated,
          maintainers: npmPkg.maintainers,
          risk_score: npmPkg.risk_score,
          repo_url: npmPkg.repo_url ?? '',
          repo_name: npmPkg.repo_url ?? '', // fallback, you may want to parse repo_name
          fetched_at: npmPkg.fetched_at,
        },
      });
    }

    // Check for duplicate
    const existing = await this.prisma.userWatchlist.findFirst({
      where: { user_id, watchlist: { package_id: pkg.package_id } },
    });
    if (existing) throw new Error('Already in watchlist');

    // Create Watchlist entry if not exists
    let watchlist = await this.prisma.watchlist.findFirst({
      where: { package_id: pkg.package_id },
    });
    if (!watchlist) {
      watchlist = await this.prisma.watchlist.create({
        data: {
          package_id: pkg.package_id,
          alert_cve_ids: [],
        },
      });
    }

    // Create UserWatchlist entry
    return this.prisma.userWatchlist.create({
      data: {
        user_id,
        watchlist_id: watchlist.watchlist_id,
        notes: request.note,
        alerts: request.alertsEnabled ? 'enabled' : 'disabled',
      },
      include: {
        watchlist: {
          include: { package: true },
        },
      },
    });
  }

  async updateWatchlistItem(
    user_id: string,
    id: string,
    request: UpdateWatchlistRequest,
  ) {
    return this.prisma.userWatchlist.update({
      where: { id },
      data: {
        notes: request.note,
        alerts: request.alertsEnabled ? 'enabled' : 'disabled',
      },
    });
  }

  async deleteWatchlistItem(user_id: string, id: string) {
    return this.prisma.userWatchlist.delete({ where: { id } });
  }
}
