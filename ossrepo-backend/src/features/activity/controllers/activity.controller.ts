import {
  Body,
  Controller,
  Post,
  Get,
  Param,
  Logger,
  Query,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { AddToWatchlistDto } from '../dto/add-to-watchlist.dto';
import { CommitSummaryDto, CommitSummaryResponseDto } from '../dto/commit-summary.dto';
import { ActivityService } from '../services/activity.service';
import { RepositorySummaryService } from '../services/repository-summary.service';
import { ScorecardService } from '../services/scorecard.service';
import { RateLimitManagerService } from '../services/rate-limit-manager.service';
import { GitHubApiService } from '../services/github-api.service';
import { PollingProcessor } from '../processors/polling.processor';
import { AlertingService } from '../services/alerting.service';
import { AIAnomalyDetectionService } from '../services/ai-anomaly-detection.service';
import { AISummaryService } from '../services/ai-summary.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('Activity')
@Controller('activity')
export class ActivityController {
  private readonly logger = new Logger(ActivityController.name);

  constructor(
    private readonly activityService: ActivityService,
    private readonly repositorySummaryService: RepositorySummaryService,
    private readonly scorecardService: ScorecardService,
    private readonly rateLimitManager: RateLimitManagerService,
    private readonly githubApiService: GitHubApiService,
    private readonly pollingProcessor: PollingProcessor,
    private readonly alertingService: AlertingService,
    private readonly aiAnomalyDetection: AIAnomalyDetectionService,
    private readonly aiSummaryService: AISummaryService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
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

  @Get('watchlist/:watchlistId/status')
  @ApiResponse({
    status: 200,
    description: 'Watchlist status retrieved successfully',
  })
  async getWatchlistStatus(@Param('watchlistId') watchlistId: string) {
    return await this.activityService.getWatchlistStatus(watchlistId);
  }

  @Get('scorecard/test')
  @ApiOperation({
    summary: 'Test Scorecard data availability for a repository',
  })
  @ApiResponse({
    status: 200,
    description: 'Scorecard data summary retrieved successfully',
  })
  async testScorecardData(
    @Query('owner') owner: string,
    @Query('repo') repo: string,
  ) {
    this.logger.log(`🔍 Testing Scorecard data for ${owner}/${repo}`);

    const summary = await this.scorecardService.getScorecardDataSummary(
      owner,
      repo,
    );
    const latestData = await this.scorecardService.getLatestScorecard(
      owner,
      repo,
    );

    return {
      summary,
      latestData: latestData
        ? {
            score: latestData.score,
            date: latestData.date,
            checksCount: latestData.checks?.length || 0,
          }
        : null,
      message: summary.hasData
        ? `✅ Scorecard data available for ${owner}/${repo}`
        : `❌ No Scorecard data found for ${owner}/${repo}`,
    };
  }

  @Get('rate-limit/status')
  @ApiOperation({
    summary: 'Get GitHub API rate limit status and processing strategy',
  })
  @ApiResponse({
    status: 200,
    description: 'Rate limit status and strategy retrieved successfully',
  })
  async getRateLimitStatus() {
    this.logger.log(`📊 Getting GitHub API rate limit status`);

    const rateLimit = await this.rateLimitManager.getRateLimitStatus();
    const strategy = await this.rateLimitManager.getProcessingStrategy();
    const timeUntilReset = await this.rateLimitManager.getTimeUntilReset();
    const isApproachingLimit = await this.rateLimitManager.isApproachingLimit();

    return {
      rateLimit,
      strategy,
      timeUntilReset,
      isApproachingLimit,
      message: `Current strategy: ${strategy.reason}`,
    };
  }

  @Get('rate-limit/token-strategy')
  @ApiOperation({
    summary: 'Get detailed token strategy and cloning thresholds',
  })
  @ApiResponse({
    status: 200,
    description: 'Token strategy summary retrieved successfully',
  })
  async getTokenStrategySummary() {
    this.logger.log(`📊 Getting token strategy summary`);

    const summary = await this.rateLimitManager.getTokenStrategySummary();

    return {
      ...summary,
      message: `Current token strategy: ${summary.strategy} - Cloning repos > ${summary.cloningThresholdMB}MB`,
      explanation: {
        strategy: summary.strategy,
        cloningThreshold: `${summary.cloningThresholdMB}MB (${summary.cloningThresholdKB}KB)`,
        apiUsage: summary.shouldUseApiForCommits
          ? 'Will use API for commits'
          : 'Will use local cloning for commits',
        tokenStatus: `${summary.remainingTokens}/${summary.totalTokens} tokens remaining (${summary.percentageUsed}% used)`,
      },
    };
  }

  @Post('test-setup')
  @ApiOperation({
    summary: 'Test repository setup with different configurations',
  })
  @ApiResponse({
    status: 201,
    description: 'Test repository setup job queued successfully',
  })
  async testRepositorySetup(
    @Body() dto: AddToWatchlistDto,
    @Query('forceLocalCloning') forceLocalCloning?: boolean,
    @Query('forceLocalHealthAnalysis') forceLocalHealthAnalysis?: boolean,
    @Query('maxCommits') maxCommits?: number,
  ) {
    this.logger.log(
      `🧪 Testing repository setup for ${dto.repo_url} with options: localCloning=${forceLocalCloning}, localHealth=${forceLocalHealthAnalysis}, maxCommits=${maxCommits || 'default'}`,
    );

    // Extract owner and repo name from GitHub URL
    const { owner, repo } = this.parseGitHubUrl(dto.repo_url);

    // Fetch repository info from GitHub API
    const repoInfo = await this.fetchGitHubRepoInfo(owner, repo);

    // Ensure user exists (create if not)
    const user = await this.ensureUserExists(dto.added_by);

    // Generate package name for lookup
    const packageName = `${owner}/${repo}`;

    // Create test watchlist entry
    const packageId = `package_${owner}_${repo}_${Date.now()}`;
    const watchlistId = `watchlist_${owner}_${repo}_${Date.now()}`;

    // Create or update package entry
    const packageEntry = await this.prisma.package.upsert({
      where: { package_name: packageName },
      update: {
        repo_url: dto.repo_url,
        repo_name: repo,
      },
      create: {
        package_id: packageId,
        package_name: packageName,
        repo_url: dto.repo_url,
        repo_name: repo,
      },
    });

    // Create new watchlist entry with processing status
    const watchlistEntry = await this.prisma.watchlist.create({
      data: {
        watchlist_id: watchlistId,
        alert_cve_ids: [],
        updated_at: new Date(),
        default_branch: repoInfo.default_branch,
        latest_commit_sha: undefined,
        commits_since_last_health_update: 0,
        package_id: packageEntry.package_id,
        status: 'processing',
        processing_started_at: new Date(),
      },
    });

    // Queue test job with specified options
    await this.activityService.queueRepositorySetupJob(
      watchlistEntry.watchlist_id,
      owner,
      repo,
      repoInfo.default_branch,
      repoInfo.is_large_repo,
      repoInfo.size,
      maxCommits,
      forceLocalCloning,
      forceLocalHealthAnalysis,
    );

    return {
      message: 'Test repository setup job queued successfully',
      watchlist_id: watchlistId,
      options: {
        forceLocalCloning: !!forceLocalCloning,
        forceLocalHealthAnalysis: !!forceLocalHealthAnalysis,
        maxCommits: maxCommits || 'default',
      },
      repository_info: {
        owner,
        repo,
        default_branch: repoInfo.default_branch,
        size: repoInfo.size,
        is_large_repo: repoInfo.is_large_repo,
      },
    };
  }

  @Get('ai-summary/test')
  @ApiOperation({ summary: 'Test AI summary generation for a repository' })
  @ApiResponse({
    status: 200,
    description: 'AI summary generated successfully',
  })
  async testAISummary(
    @Query('owner') owner: string,
    @Query('repo') repo: string,
  ) {
    this.logger.log(`🤖 Testing AI summary generation for ${owner}/${repo}`);

    try {
      const result = await this.repositorySummaryService.testSummaryGeneration(
        owner,
        repo,
      );

      return {
        success: result.success,
        summary: result.summary
          ? {
              text: result.summary.summary,
              confidence: result.summary.confidence,
              model: result.summary.modelUsed,
              generatedAt: result.summary.generatedAt,
            }
          : null,
        error: result.error,
        message: result.success
          ? `✅ AI summary generated successfully for ${owner}/${repo}`
          : `❌ Failed to generate AI summary for ${owner}/${repo}: ${result.error}`,
      };
    } catch (error) {
      this.logger.error(
        `Error testing AI summary for ${owner}/${repo}:`,
        error,
      );
      return {
        success: false,
        error: error.message,
        message: `❌ Error testing AI summary for ${owner}/${repo}`,
      };
    }
  }

  @Get('ai-anomaly-detection/test')
  @ApiOperation({ summary: 'Test AI anomaly detection for a commit' })
  @ApiResponse({
    status: 200,
    description: 'AI anomaly detection test completed',
  })
  async testAIAnomalyDetection(
    @Query('owner') owner: string,
    @Query('repo') repo: string,
  ) {
    this.logger.log(`🤖 Testing AI anomaly detection for ${owner}/${repo}`);

    try {
      // Test the AI model connection first
      const modelConnected = await this.aiAnomalyDetection.testModelConnection();
      
      if (!modelConnected) {
        return {
          success: false,
          error: 'AI model not available',
          message: '❌ AI model (Gemma2:2b) is not available. Please ensure Ollama is running and the model is downloaded.',
        };
      }

      // Create a test commit with suspicious characteristics
      const testCommitData = {
        sha: 'test123456789',
        author: 'Test User',
        email: 'test@example.com',
        message: 'WIP: massive refactor - removing all security checks',
        date: new Date(),
        linesAdded: 1500,
        linesDeleted: 800,
        filesChanged: ['src/security/auth.js', 'src/security/permissions.js', 'src/config/database.js', 'src/api/endpoints.js'],
        contributorStats: {
          avgLinesAdded: 50,
          avgLinesDeleted: 20,
          avgFilesChanged: 2,
          stddevLinesAdded: 30,
          stddevLinesDeleted: 15,
          stddevFilesChanged: 1,
          totalCommits: 25,
          commitTimeHistogram: { '9': 5, '10': 8, '11': 6, '14': 4, '15': 2 },
        },
        repoStats: {
          avgLinesAdded: 80,
          avgLinesDeleted: 30,
          avgFilesChanged: 3,
          totalCommits: 1500,
          totalContributors: 45,
        },
      };

      const result = await this.aiAnomalyDetection.analyzeCommitForAnomalies(testCommitData);

      return {
        success: true,
        testCommit: {
          sha: testCommitData.sha,
          author: testCommitData.author,
          message: testCommitData.message,
          linesChanged: testCommitData.linesAdded + testCommitData.linesDeleted,
          filesChanged: testCommitData.filesChanged.length,
        },
        analysis: {
          isAnomalous: result.isAnomalous,
          confidence: result.confidence,
          reasoning: result.reasoning,
          riskLevel: result.riskLevel,
          suspiciousFactors: result.suspiciousFactors,
        },
        message: result.isAnomalous
          ? `🚨 AI detected suspicious activity in test commit (confidence: ${(result.confidence * 100).toFixed(1)}%)`
          : `✅ AI analysis completed - no anomalies detected in test commit`,
      };
    } catch (error) {
      this.logger.error(
        `Error testing AI anomaly detection for ${owner}/${repo}:`,
        error,
      );
      return {
        success: false,
        error: error.message,
        message: `❌ Error testing AI anomaly detection for ${owner}/${repo}`,
      };
    }
  }

  @Post('watchlist/:watchlistId/commit-summary')
  @ApiOperation({
    summary: 'Generate AI summary of recent commits for a watchlist',
  })
  @ApiResponse({
    status: 200,
    description: 'Commit summary generated successfully',
    type: CommitSummaryResponseDto,
  })
  async generateCommitSummary(
    @Param('watchlistId') watchlistId: string,
    @Body() dto: CommitSummaryDto,
  ) {
    this.logger.log(`🤖 Generating commit summary for watchlist ${watchlistId} (${dto.commitCount || 10} commits)`);

    try {
      // Verify the watchlist exists and get repository info
      const watchlist = await this.prisma.watchlist.findUnique({
        where: { watchlist_id: watchlistId },
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
          watchlist_id: watchlistId,
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

      const uniqueAuthors = [...new Set(commitData.map(c => c.author))];
      const dateRange = `${commitData[commitData.length - 1].timestamp.toISOString().split('T')[0]} to ${commitData[0].timestamp.toISOString().split('T')[0]}`;

      return {
        summary: aiResult.summary,
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
      throw new HttpException(
        `Failed to generate commit summary: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('health-data/test')
  @ApiOperation({
    summary: 'Test health data retrieval for a watchlist',
  })
  @ApiResponse({
    status: 200,
    description: 'Health data retrieved successfully',
  })
  async testHealthData() {
    this.logger.log(`🔍 Testing health data retrieval`);

    const healthData = await this.prisma.healthData.findMany({
      take: 5,
      orderBy: { created_at: 'desc' },
      include: {
        watchlist: {
          include: {
            package: true,
          },
        },
      },
    });

    return {
      count: healthData.length,
      data: healthData.map((item) => ({
        id: item.id,
        watchlist_id: item.watchlist_id,
        repo_name: item.watchlist.package.repo_name,
        commit_sha: item.commit_sha,
        overall_health_score: item.overall_health_score,
        analysis_date: item.analysis_date,
        source: item.source,
        created_at: item.created_at,
      })),
    };
  }

  @Get('watchlist/:watchlistId/contributor-stats')
  @ApiOperation({
    summary: 'Get contributor statistics for a watchlist',
  })
  @ApiResponse({
    status: 200,
    description: 'Contributor statistics retrieved successfully',
  })
  async getContributorStats(@Param('watchlistId') watchlistId: string) {
    this.logger.log(`📊 Getting contributor stats for watchlist ${watchlistId}`);

    const contributorStats = await this.prisma.contributorStats.findMany({
      where: { watchlist_id: watchlistId },
      orderBy: { total_commits: 'desc' },
    });

    return {
      watchlist_id: watchlistId,
      count: contributorStats.length,
      contributors: contributorStats.map((stat) => ({
        author_email: stat.author_email,
        author_name: stat.author_name,
        total_commits: stat.total_commits,
        avg_lines_added: stat.avg_lines_added,
        avg_lines_deleted: stat.avg_lines_deleted,
        avg_files_changed: stat.avg_files_changed,
        last_commit_date: stat.last_commit_date,
        typical_days_active: stat.typical_days_active,
      })),
    };
  }

  @Get('watchlist/:watchlistId/repo-stats')
  @ApiOperation({
    summary: 'Get repository statistics for a watchlist',
  })
  @ApiResponse({
    status: 200,
    description: 'Repository statistics retrieved successfully',
  })
  async getRepoStats(@Param('watchlistId') watchlistId: string) {
    this.logger.log(`📊 Getting repo stats for watchlist ${watchlistId}`);

    const repoStats = await this.prisma.repoStats.findUnique({
      where: { watchlist_id: watchlistId },
    });

    if (!repoStats) {
      throw new HttpException(
        'Repository statistics not found for this watchlist',
        HttpStatus.NOT_FOUND,
      );
    }

    return {
      watchlist_id: watchlistId,
      total_commits: repoStats.total_commits,
      avg_lines_added: repoStats.avg_lines_added,
      avg_lines_deleted: repoStats.avg_lines_deleted,
      avg_files_changed: repoStats.avg_files_changed,
      commit_time_histogram: repoStats.commit_time_histogram,
      typical_days_active: repoStats.typical_days_active,
      last_updated: repoStats.last_updated,
    };
  }

  @Post('watchlist/:watchlistId/calculate-stats')
  @ApiOperation({
    summary: 'Manually trigger calculation of repository and contributor statistics',
  })
  @ApiResponse({
    status: 200,
    description: 'Statistics calculation completed successfully',
  })
  async calculateStats(@Param('watchlistId') watchlistId: string) {
    this.logger.log(`📊 Manually triggering stats calculation for watchlist ${watchlistId}`);

    try {
      // Import GitManagerService here to avoid circular dependency
      const { GitManagerService } = await import('../services/git-manager.service');
      const gitManager = new GitManagerService(
        this.configService,
        this.prisma,
      );

      await gitManager.updateContributorStats(watchlistId);

      return {
        watchlist_id: watchlistId,
        message: 'Statistics calculation completed successfully',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`❌ Failed to calculate stats: ${error.message}`);
      throw new HttpException(
        `Failed to calculate statistics: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('trigger-polling')
  @ApiOperation({
    summary: 'Manually trigger daily polling for all repositories',
  })
  @ApiResponse({
    status: 200,
    description: 'Daily polling triggered successfully',
  })
  async triggerPolling() {
    this.logger.log(`🔍 Manually triggering daily polling`);

    try {
      await this.pollingProcessor.triggerPolling();

      return {
        message: 'Daily polling triggered successfully',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`Error triggering polling: ${error.message}`);
      throw new HttpException(
        `Failed to trigger polling: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('alerts/:userWatchlistId')
  @ApiOperation({
    summary: 'Get triggered alerts for a user watchlist',
  })
  @ApiResponse({
    status: 200,
    description: 'Alerts retrieved successfully',
  })
  async getAlerts(@Param('userWatchlistId') userWatchlistId: string) {
    this.logger.log(`📊 Getting alerts for user watchlist ${userWatchlistId}`);

    try {
      const alerts = await this.prisma.alertTriggered.findMany({
        where: { user_watchlist_id: userWatchlistId },
        orderBy: { created_at: 'desc' },
        include: {
          watchlist: {
            include: {
              package: {
                select: {
                  repo_name: true,
                  repo_url: true,
                },
              },
            },
          },
        },
      });

      return {
        alerts,
        count: alerts.length,
        userWatchlistId,
      };
    } catch (error) {
      this.logger.error(`Error getting alerts: ${error.message}`);
      throw new HttpException(
        `Failed to get alerts: ${error.message}`,
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
}
