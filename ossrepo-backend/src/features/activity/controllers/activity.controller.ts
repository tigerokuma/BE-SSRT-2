import { Body, Controller, Post, Get, Param, Logger, Query, HttpException, HttpStatus } from '@nestjs/common';
import { AddToWatchlistDto } from '../dto/add-to-watchlist.dto';
import { ActivityService } from '../services/activity.service';
import { RepositorySummaryService } from '../services/repository-summary.service';
import { ScorecardService } from '../services/scorecard.service';
import { RateLimitManagerService } from '../services/rate-limit-manager.service';
import { GitHubApiService } from '../services/github-api.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
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
    private readonly prisma: PrismaService,
  ) {}

  @Post('user-watchlist-added')
  @ApiResponse({ status: 201, description: 'Repository added to watchlist with alert configuration' })
  async addToWatchlist(@Body() dto: AddToWatchlistDto) {
    this.logger.log(`📝 Adding ${dto.repo_url} to watchlist (${dto.added_by})`);
    
    // Call the service to handle database operations
    const result = await this.activityService.addToWatchlist(dto);
    
    return result;
  }

  @Get('watchlist/:watchlistId/status')
  @ApiResponse({ status: 200, description: 'Watchlist status retrieved successfully' })
  async getWatchlistStatus(@Param('watchlistId') watchlistId: string) {
    return await this.activityService.getWatchlistStatus(watchlistId);
  }

  @Get('scorecard/test')
  @ApiOperation({ summary: 'Test Scorecard data availability for a repository' })
  @ApiResponse({ status: 200, description: 'Scorecard data summary retrieved successfully' })
  async testScorecardData(
    @Query('owner') owner: string,
    @Query('repo') repo: string
  ) {
    this.logger.log(`🔍 Testing Scorecard data for ${owner}/${repo}`);
    
    const summary = await this.scorecardService.getScorecardDataSummary(owner, repo);
    const latestData = await this.scorecardService.getLatestScorecard(owner, repo);
    
    return {
      summary,
      latestData: latestData ? {
        score: latestData.score,
        date: latestData.date,
        checksCount: latestData.checks?.length || 0
      } : null,
      message: summary.hasData 
        ? `✅ Scorecard data available for ${owner}/${repo}`
        : `❌ No Scorecard data found for ${owner}/${repo}`
    };
  }

  @Get('rate-limit/status')
  @ApiOperation({ summary: 'Get GitHub API rate limit status and processing strategy' })
  @ApiResponse({ status: 200, description: 'Rate limit status and strategy retrieved successfully' })
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
  @ApiOperation({ summary: 'Get detailed token strategy and cloning thresholds' })
  @ApiResponse({ status: 200, description: 'Token strategy summary retrieved successfully' })
  async getTokenStrategySummary() {
    this.logger.log(`📊 Getting token strategy summary`);
    
    const summary = await this.rateLimitManager.getTokenStrategySummary();
    
    return {
      ...summary,
      message: `Current token strategy: ${summary.strategy} - Cloning repos > ${summary.cloningThresholdMB}MB`,
      explanation: {
        strategy: summary.strategy,
        cloningThreshold: `${summary.cloningThresholdMB}MB (${summary.cloningThresholdKB}KB)`,
        apiUsage: summary.shouldUseApiForCommits ? 'Will use API for commits' : 'Will use local cloning for commits',
        tokenStatus: `${summary.remainingTokens}/${summary.totalTokens} tokens remaining (${summary.percentageUsed}% used)`,
      },
    };
  }

  @Post('test-setup')
  @ApiOperation({ summary: 'Test repository setup with different configurations' })
  @ApiResponse({ status: 201, description: 'Test repository setup job queued successfully' })
  async testRepositorySetup(
    @Body() dto: AddToWatchlistDto,
    @Query('forceLocalCloning') forceLocalCloning?: boolean,
    @Query('forceLocalHealthAnalysis') forceLocalHealthAnalysis?: boolean,
    @Query('maxCommits') maxCommits?: number
  ) {
    this.logger.log(`🧪 Testing repository setup for ${dto.repo_url} with options: localCloning=${forceLocalCloning}, localHealth=${forceLocalHealthAnalysis}, maxCommits=${maxCommits || 'default'}`);
    
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
      forceLocalHealthAnalysis
    );

    return {
      message: 'Test repository setup job queued successfully',
      watchlist_id: watchlistId,
      options: {
        forceLocalCloning: !!forceLocalCloning,
        forceLocalHealthAnalysis: !!forceLocalHealthAnalysis,
        maxCommits: maxCommits || 'default'
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
  @ApiResponse({ status: 200, description: 'AI summary generated successfully' })
  async testAISummary(
    @Query('owner') owner: string,
    @Query('repo') repo: string
  ) {
    this.logger.log(`🤖 Testing AI summary generation for ${owner}/${repo}`);
    
    try {
      const result = await this.repositorySummaryService.testSummaryGeneration(owner, repo);
      
      return {
        success: result.success,
        summary: result.summary ? {
          text: result.summary.summary,
          confidence: result.summary.confidence,
          model: result.summary.modelUsed,
          generatedAt: result.summary.generatedAt,
        } : null,
        error: result.error,
        message: result.success 
          ? `✅ AI summary generated successfully for ${owner}/${repo}`
          : `❌ Failed to generate AI summary for ${owner}/${repo}: ${result.error}`
      };
    } catch (error) {
      this.logger.error(`Error testing AI summary for ${owner}/${repo}:`, error);
      return {
        success: false,
        error: error.message,
        message: `❌ Error testing AI summary for ${owner}/${repo}`
      };
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
        throw new Error('Invalid GitHub repository URL format. Expected: https://github.com/owner/repo');
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
      throw new HttpException('Invalid GitHub repository URL', HttpStatus.BAD_REQUEST);
    }
  }

  private async fetchGitHubRepoInfo(owner: string, repo: string) {
    try {
      const repoData = await this.githubApiService.getRepositoryInfo(owner, repo);
      
      if (repoData.private) {
        throw new Error('Private repositories are not supported');
      }

      const isLargeRepo = repoData.stargazers_count > 100 || (repoData.size / 1024) > 100 || repoData.forks_count > 100;
      
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