import {
  Body,
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Logger,
  Query,
  HttpException,
  HttpStatus,
  Delete,
  NotFoundException,
  InternalServerErrorException,
  Put,
} from '@nestjs/common';
import { AddToWatchlistDto } from '../dto/add-to-watchlist.dto';
import {
  CommitSummaryDto,
  CommitSummaryResponseDto,
} from '../dto/commit-summary.dto';
import { ActivityService } from '../services/activity.service';
import { RepositorySummaryService } from '../services/repository-summary.service';
import { HealthAnalysisService } from '../services/health-analysis.service';

import { GitHubApiService } from '../services/github-api.service';
import { PollingProcessor } from '../processors/polling.processor';
import { VulnerabilityCheckProcessor } from '../processors/vulnerability-check.processor';
import { HealthCheckProcessor } from '../processors/health-check.processor';
import { AlertingService } from '../services/alerting.service';
import { AIAnomalyDetectionService } from '../services/ai-anomaly-detection.service';
import { AISummaryService } from '../services/ai-summary.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiResponse } from '@nestjs/swagger';
import { BusFactorService } from '../services/bus-factor.service';
import { VulnerabilityService } from '../services/vulnerability.service';

@ApiTags('Activity')
@Controller('activity')
export class ActivityController {
  private readonly logger = new Logger(ActivityController.name);

  constructor(
    private readonly activityService: ActivityService,
    private readonly repositorySummaryService: RepositorySummaryService,
    private readonly healthAnalysisService: HealthAnalysisService,

    private readonly githubApiService: GitHubApiService,
    private readonly pollingProcessor: PollingProcessor,
    private readonly vulnerabilityCheckProcessor: VulnerabilityCheckProcessor,
    private readonly healthCheckProcessor: HealthCheckProcessor,
    private readonly alertingService: AlertingService,
    private readonly aiAnomalyDetection: AIAnomalyDetectionService,
    private readonly aiSummaryService: AISummaryService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly busFactorService: BusFactorService,
    private readonly vulnerabilityService: VulnerabilityService,
  ) {}

  @Post('user-watchlist-added')
  @ApiResponse({
    status: 201,
    description: 'Repository added to watchlist with alert configuration',
  })
  async addToWatchlist(@Body() dto: AddToWatchlistDto) {
    this.logger.log(`📝 Adding ${dto.repo_url} to watchlist (${dto.added_by})`);

    // Call the service to handle database operations
    const result = await this.activityService.addToWatchlist(dto);

    return result;
  }

  @Put('user-watchlist-alerts/:userWatchlistId')
  @ApiResponse({
    status: 200,
    description: 'Alert settings updated successfully',
  })
  async updateUserWatchlistAlerts(
    @Param('userWatchlistId') userWatchlistId: string,
    @Body() body: { alerts: any },
  ) {
    this.logger.log(
      `📝 Updating alert settings for user watchlist ${userWatchlistId}`,
    );

    try {
      await this.activityService.updateUserWatchlistAlerts(
        userWatchlistId,
        body.alerts,
      );
      return { success: true, message: 'Alert settings updated successfully' };
    } catch (error) {
      this.logger.error(`Error updating alert settings: ${error.message}`);
      throw new HttpException(
        `Failed to update alert settings: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('watchlist/:watchlistId/status')
  @ApiResponse({
    status: 200,
    description: 'Watchlist status retrieved successfully',
  })
  async getWatchlistStatus(@Param('watchlistId') watchlistId: string) {
    return await this.activityService.getWatchlistStatus(watchlistId);
  }

  @Post('watchlist/:watchlistId/commit-summary')
  @ApiResponse({
    status: 200,
    description: 'Commit summary generated successfully',
    type: CommitSummaryResponseDto,
  })
  async generateCommitSummary(
    @Param('watchlistId') watchlistId: string,
    @Body() dto: CommitSummaryDto,
  ) {
    this.logger.log(
      `🤖 Generating commit summary for watchlist ${watchlistId} (${dto.commitCount || 10} commits)`,
    );

    try {
      // First, try to find the UserWatchlist record to get the actual watchlist_id
      let actualWatchlistId = watchlistId;

      // Check if this is a user watchlist ID
      if (watchlistId.includes('user_watchlist_')) {
        const userWatchlist = await this.prisma.userWatchlist.findUnique({
          where: { id: watchlistId },
          select: { watchlist_id: true },
        });

        if (userWatchlist) {
          actualWatchlistId = userWatchlist.watchlist_id;
          this.logger.log(
            `🔍 Found UserWatchlist, using watchlist_id: ${actualWatchlistId}`,
          );
        } else {
          this.logger.log(
            `🔍 UserWatchlist not found, trying as direct watchlist_id: ${watchlistId}`,
          );
        }
      }

      this.logger.log(`🔍 Looking for watchlist with ID: ${actualWatchlistId}`);

      // Verify the watchlist exists and get repository info
      const watchlist = await this.prisma.watchlist.findUnique({
        where: { watchlist_id: actualWatchlistId },
        include: {
          package: true,
        },
      });

      if (!watchlist) {
        throw new HttpException(
          `Watchlist ${watchlistId} not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      // Get recent commits from the database
      const commits = await this.prisma.log.findMany({
        where: {
          watchlist_id: actualWatchlistId,
          event_type: 'COMMIT',
        },
        orderBy: { timestamp: 'desc' },
        take: dto.commitCount || 10,
      });

      if (commits.length === 0) {
        return {
          summary: 'No recent commits found to summarize.',
          commitCount: 0,
          dateRange: 'N/A',
          totalLinesAdded: 0,
          totalLinesDeleted: 0,
          totalFilesChanged: 0,
          authors: [],
          generatedAt: new Date(),
        };
      }

      // Transform commit data for AI summary
      const commitData = commits.map((commit) => ({
        sha: (commit.payload as any)?.sha || 'unknown',
        message: (commit.payload as any)?.message || commit.actor,
        author: commit.actor,
        email: (commit.payload as any)?.email || 'unknown@example.com',
        timestamp: commit.timestamp,
        filesChanged: commit.files_changed || 0,
        linesAdded: commit.lines_added || 0,
        linesDeleted: commit.lines_deleted || 0,
      }));

      // Generate AI summary
      const aiResult = await this.aiSummaryService.generateCommitSummary(
        commitData,
        watchlist.package.repo_name,
      );

      // Calculate additional statistics
      const totalStats = commitData.reduce(
        (acc, commit) => ({
          linesAdded: acc.linesAdded + commit.linesAdded,
          linesDeleted: acc.linesDeleted + commit.linesDeleted,
          filesChanged: acc.filesChanged + commit.filesChanged,
        }),
        { linesAdded: 0, linesDeleted: 0, filesChanged: 0 },
      );

      const uniqueAuthors = [...new Set(commitData.map((c) => c.author))];
      const dateRange = `${commitData[commitData.length - 1].timestamp.toISOString().split('T')[0]} to ${commitData[0].timestamp.toISOString().split('T')[0]}`;

      // Validate AI result
      let summary = aiResult.summary;
      if (
        !summary ||
        summary.trim() === '' ||
        summary === 'No summary available.'
      ) {
        this.logger.warn(
          `AI summary generation failed for ${watchlist.package.repo_name}, using fallback`,
        );
        summary = `Recent activity in ${watchlist.package.repo_name} shows ${commitData.length} commits from ${uniqueAuthors.length} authors. Total changes: +${totalStats.linesAdded} -${totalStats.linesDeleted} lines across ${totalStats.filesChanged} files.`;
      }

      return {
        summary,
        commitCount: commitData.length,
        dateRange,
        totalLinesAdded: totalStats.linesAdded,
        totalLinesDeleted: totalStats.linesDeleted,
        totalFilesChanged: totalStats.filesChanged,
        authors: uniqueAuthors,
        generatedAt: aiResult.generatedAt,
      };
    } catch (error) {
      this.logger.error(
        `Error generating commit summary for watchlist ${watchlistId}:`,
        error,
      );

      // Provide a more helpful error message
      let errorMessage = 'Failed to generate commit summary';
      if (error.message.includes('AI model')) {
        errorMessage = 'AI model is unavailable, please try again later';
      } else if (error.message.includes('timeout')) {
        errorMessage = 'Request timed out, please try again';
      } else if (error.message.includes('not found')) {
        errorMessage = 'Repository not found or no commits available';
      }

      throw new HttpException(errorMessage, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('watchlist/:watchlistId/commits')
  @ApiResponse({
    status: 200,
    description: 'Recent commits retrieved successfully',
  })
  async getRecentCommits(
    @Param('watchlistId') watchlistId: string,
    @Query('limit') limit?: number,
  ) {
    this.logger.log(
      `📝 Getting recent commits for watchlist ${watchlistId} (limit: ${limit || 50})`,
    );

    try {
      // First, try to find the UserWatchlist record to get the actual watchlist_id
      let actualWatchlistId = watchlistId;

      // Check if this is a user watchlist ID
      if (watchlistId.includes('user_watchlist_')) {
        const userWatchlist = await this.prisma.userWatchlist.findUnique({
          where: { id: watchlistId },
          select: { watchlist_id: true },
        });

        if (userWatchlist) {
          actualWatchlistId = userWatchlist.watchlist_id;
          this.logger.log(
            `🔍 Found UserWatchlist, using watchlist_id: ${actualWatchlistId}`,
          );
        } else {
          this.logger.log(
            `🔍 UserWatchlist not found, trying as direct watchlist_id: ${watchlistId}`,
          );
        }
      }

      this.logger.log(`🔍 Looking for watchlist with ID: ${actualWatchlistId}`);

      // Verify the watchlist exists
      const watchlist = await this.prisma.watchlist.findUnique({
        where: { watchlist_id: actualWatchlistId },
        include: {
          package: true,
        },
      });

      if (!watchlist) {
        throw new HttpException(
          `Watchlist ${watchlistId} not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      // Get recent commits from the database
      const commits = await this.prisma.log.findMany({
        where: {
          watchlist_id: actualWatchlistId,
          event_type: 'COMMIT',
        },
        orderBy: { timestamp: 'desc' },
        take: limit || 50,
        select: {
          event_id: true,
          actor: true,
          timestamp: true,
          payload: true,
          lines_added: true,
          lines_deleted: true,
          files_changed: true,
        },
      });

      // Get AI-detected anomalies for this watchlist
      const aiAnomalies = await this.prisma.aIAnomaliesDetected.findMany({
        where: {
          watchlist_id: actualWatchlistId,
        },
        select: {
          commit_sha: true,
          anomaly_details: true,
        },
      });

      // Create a map of commit SHA to AI anomaly details
      const aiAnomalyMap = new Map();
      aiAnomalies.forEach((anomaly) => {
        const details = anomaly.anomaly_details as any;
        aiAnomalyMap.set(anomaly.commit_sha, {
          isAnomalous: details.isAnomalous || false,
          reasoning: details.reasoning || '',
          riskLevel: details.riskLevel || 'low',
          confidence: details.confidence || 0,
          suspiciousFactors: details.suspiciousFactors || [],
        });
      });

      // Transform commits to frontend format
      const transformedCommits = commits.map((commit) => {
        const payload = commit.payload as any;
        const timeAgo = this.getTimeAgo(commit.timestamp);
        const commitSha =
          payload?.sha || commit.event_id.replace('commit_', '');

        // Check if this commit has an AI anomaly
        const aiAnomaly = aiAnomalyMap.get(commitSha);
        const isSuspicious = aiAnomaly?.isAnomalous || false;
        const suspiciousReason = aiAnomaly?.reasoning || '';

        return {
          id: commit.event_id,
          message: payload?.message || 'No message',
          author: commit.actor,
          time: timeAgo,
          avatar: '/placeholder-user.jpg', // Default avatar
          initials: this.getInitials(commit.actor),
          linesAdded: payload?.lines_added || commit.lines_added || 0,
          linesDeleted: payload?.lines_deleted || commit.lines_deleted || 0,
          filesChanged:
            payload?.files_changed?.length || commit.files_changed || 0,
          isSuspicious,
          suspiciousReason,
          sha: commitSha,
        };
      });

      return {
        watchlist_id: actualWatchlistId,
        commits: transformedCommits,
        total_count: transformedCommits.length,
        repository_name: watchlist.package.package_name,
      };
    } catch (error) {
      this.logger.error(`❌ Failed to get recent commits: ${error.message}`);
      throw new HttpException(
        `Failed to get recent commits: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete('user-watchlist/:userWatchlistId')
  async removeFromWatchlist(@Param('userWatchlistId') userWatchlistId: string) {
    this.logger.log(`📝 Removing user watchlist ${userWatchlistId}`);
    try {
      await this.activityService.removeFromWatchlist(userWatchlistId);
      return { message: 'Repository removed from watchlist successfully' };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        'Failed to remove repository from watchlist',
      );
    }
  }

  @Patch('alerts/:alertId/acknowledge')
  @ApiResponse({
    status: 200,
    description: 'Alert acknowledged successfully',
  })
  async acknowledgeAlert(@Param('alertId') alertId: string) {
    this.logger.log(`📝 Acknowledging alert ${alertId}`);

    try {
      await this.prisma.alertTriggered.update({
        where: { id: alertId },
        data: { acknowledged_at: new Date() },
      });

      return { success: true, message: 'Alert acknowledged successfully' };
    } catch (error) {
      this.logger.error(`Error acknowledging alert: ${error.message}`);
      throw new HttpException(
        `Failed to acknowledge alert: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Patch('alerts/:alertId/resolve')
  @ApiResponse({
    status: 200,
    description: 'Alert resolved successfully',
  })
  async resolveAlert(@Param('alertId') alertId: string) {
    this.logger.log(`✅ Resolving alert ${alertId}`);

    try {
      await this.prisma.alertTriggered.update({
        where: { id: alertId },
        data: { resolved_at: new Date() },
      });

      return { success: true, message: 'Alert resolved successfully' };
    } catch (error) {
      this.logger.error(`Error resolving alert: ${error.message}`);
      throw new HttpException(
        `Failed to resolve alert: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('alerts/:userWatchlistId')
  @ApiResponse({
    status: 200,
    description: 'Alerts retrieved successfully',
  })
  async getAlerts(@Param('userWatchlistId') userWatchlistId: string) {
    this.logger.log(`📝 Getting alerts for user watchlist ${userWatchlistId}`);

    try {
      // Verify the user watchlist exists
      const userWatchlist = await this.prisma.userWatchlist.findUnique({
        where: { id: userWatchlistId },
        include: {
          watchlist: {
            include: {
              package: true,
            },
          },
        },
      });

      if (!userWatchlist) {
        throw new HttpException(
          `User watchlist not found: ${userWatchlistId}`,
          HttpStatus.NOT_FOUND,
        );
      }

      // Get all alerts for this user watchlist
      const alerts = await this.prisma.alertTriggered.findMany({
        where: { user_watchlist_id: userWatchlistId },
        include: {
          watchlist: {
            include: {
              package: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
      });

      return {
        alerts,
        count: alerts.length,
        userWatchlistId,
      };
    } catch (error) {
      this.logger.error(`Error fetching alerts: ${error.message}`);
      throw new HttpException(
        `Failed to fetch alerts: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // Helper methods (copied from ActivityService for testing)
  private parseGitHubUrl(url: string): { owner: string; repo: string } {
    try {
      const urlObj = new URL(url);

      if (!urlObj.hostname.includes('github.com')) {
        throw new Error('URL must be a GitHub repository URL');
      }

      const pathParts = urlObj.pathname.split('/').filter(Boolean);

      if (pathParts.length < 2) {
        throw new Error(
          'Invalid GitHub repository URL format. Expected: https://github.com/owner/repo',
        );
      }

      const owner = pathParts[0];
      const repo = pathParts[1].replace('.git', '');

      if (!owner || !repo) {
        throw new Error('Invalid owner or repository name');
      }

      return { owner, repo };
    } catch (error) {
      if (error instanceof Error) {
        throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
      }
      throw new HttpException(
        'Invalid GitHub repository URL',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async fetchGitHubRepoInfo(owner: string, repo: string) {
    try {
      const repoData = await this.githubApiService.getRepositoryInfo(
        owner,
        repo,
      );

      if (repoData.private) {
        throw new Error('Private repositories are not supported');
      }

      const isLargeRepo =
        repoData.stargazers_count > 100 ||
        repoData.size / 1024 > 100 ||
        repoData.forks_count > 100;

      return {
        default_branch: repoData.default_branch || 'main',
        name: repoData.name,
        full_name: repoData.full_name,
        description: repoData.description,
        private: repoData.private,
        fork: repoData.fork,
        stargazers_count: repoData.stargazers_count,
        watchers_count: repoData.watchers_count,
        forks_count: repoData.forks_count,
        size: repoData.size,
        is_large_repo: isLargeRepo,
      };
    } catch (error) {
      throw new HttpException(
        `Failed to fetch repository info: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private async ensureUserExists(userId: string) {
    try {
      let user = await this.prisma.user.findUnique({
        where: { user_id: userId },
      });

      if (!user) {
        user = await this.prisma.user.create({
          data: {
            user_id: userId,
            email: `${userId}@example.com`,
            name: userId,
          },
        });
      }

      return user;
    } catch (error) {
      throw new HttpException(
        `Failed to create/find user: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private getTimeAgo(date: Date): string {
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) {
      return `${diffInSeconds} seconds ago`;
    }

    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) {
      return `${diffInMinutes} minute${diffInMinutes > 1 ? 's' : ''} ago`;
    }

    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) {
      return `${diffInHours} hour${diffInHours > 1 ? 's' : ''} ago`;
    }

    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 7) {
      return `${diffInDays} day${diffInDays > 1 ? 's' : ''} ago`;
    }

    const diffInWeeks = Math.floor(diffInDays / 7);
    if (diffInWeeks < 4) {
      return `${diffInWeeks} week${diffInWeeks > 1 ? 's' : ''} ago`;
    }

    const diffInMonths = Math.floor(diffInDays / 30);
    if (diffInMonths < 12) {
      return `${diffInMonths} month${diffInMonths > 1 ? 's' : ''} ago`;
    }

    const diffInYears = Math.floor(diffInDays / 365);
    return `${diffInYears} year${diffInYears > 1 ? 's' : ''} ago`;
  }

  private getInitials(name: string): string {
    if (!name) return 'U';

    const parts = name.split(' ').filter((part) => part.length > 0);
    if (parts.length === 0) return 'U';

    if (parts.length === 1) {
      return parts[0].substring(0, 2).toUpperCase();
    }

    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
}
