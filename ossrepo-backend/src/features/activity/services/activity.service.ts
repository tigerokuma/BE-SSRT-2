import {
  Injectable,
  HttpException,
  HttpStatus,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AddToWatchlistDto } from '../dto/add-to-watchlist.dto';
import { GitHubApiService } from './github-api.service';
import { GraphService } from '../../graph/services/graph.service';
import { SbomQueueService } from 'src/features/sbom/services/sbom-queue.service';

@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('repository-setup')
    private readonly repositorySetupQueue: Queue,
    @InjectQueue('polling')
    private readonly pollingQueue: Queue,
    private readonly githubApiService: GitHubApiService,
    private readonly graphService: GraphService,
    private readonly sbomQueueService: SbomQueueService,
  ) {}

  async addToWatchlist(dto: AddToWatchlistDto) {
    try {
      const { owner, repo } = this.parseGitHubUrl(dto.repo_url);
      const repoInfo = await this.fetchGitHubRepoInfo(owner, repo);
      const user = await this.ensureUserExists(dto.added_by);
      const packageName = `${owner}/${repo}`;

      const existingPackage = await this.prisma.package.findUnique({
        where: { package_name: packageName },
        include: {
          watchlists: {
            include: {
              userWatchlistEntries: {
                where: { user_id: user.user_id },
              },
            },
          },
        },
      });

      let watchlistEntry;
      let userWatchlistEntry;
      let shouldQueueSetup = false;

      if (existingPackage && existingPackage.watchlists.length > 0) {
        const existingWatchlist = existingPackage.watchlists[0];

        if (existingWatchlist.userWatchlistEntries.length > 0) {
          throw new HttpException(
            'You are already watching this repository',
            HttpStatus.CONFLICT,
          );
        }

        watchlistEntry = existingWatchlist;
        const userWatchlistId = `user_watchlist_${dto.added_by}_${existingWatchlist.watchlist_id}`;
        userWatchlistEntry = await this.prisma.userWatchlist.create({
          data: {
            id: userWatchlistId,
            user_id: user.user_id,
            watchlist_id: existingWatchlist.watchlist_id,
            added_at: new Date(),
            alerts: JSON.stringify(dto.alerts),
            created_at: new Date(),
          },
        });


        shouldQueueSetup = false;
      } else {
        const packageId = `package_${owner}_${repo}_${Date.now()}`;
        const watchlistId = `watchlist_${owner}_${repo}_${Date.now()}`;
        const userWatchlistId = `user_watchlist_${dto.added_by}_${watchlistId}`;

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

        watchlistEntry = await this.prisma.watchlist.create({
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

        userWatchlistEntry = await this.prisma.userWatchlist.create({
          data: {
            id: userWatchlistId,
            user_id: user.user_id,
            watchlist_id: watchlistId,
            added_at: new Date(),
            alerts: JSON.stringify(dto.alerts),
            created_at: new Date(),
          },
        });

        // SBOM generation moved to project creation for optimization
        // await this.sbomQueueService.fullProcessSbom(
        //   userWatchlistEntry.watchlist_id,
        //   user.user_id,
        // );

        shouldQueueSetup = true;
      }

      if (shouldQueueSetup) {
        await this.queueRepositorySetupJob(
          watchlistEntry.watchlist_id,
          owner,
          repo,
          repoInfo.default_branch,
          repoInfo.is_large_repo,
          repoInfo.size,
        );
      }

      const repoId = `${owner}/${repo}`;

      // TODO: Temporarily disabled graph build due to connection issues
      // try {
      //   await this.graphService.triggerBuild(repoId, {});
      //   this.logger.log(`Triggered graph build for ${repoId}`);
      // } catch (e) {
      //   this.logger.error(
      //     `Failed to trigger graph build for ${repoId}: ${e?.message || e}`,
      //   );
      // }

      return {
        message: shouldQueueSetup
          ? 'Repository added to watchlist. Background processing will begin shortly.'
          : 'Repository already exists in watchlist. You have been added as a watcher.',
        user: user,
        watchlist: watchlistEntry,
        userWatchlist: userWatchlistEntry,
        repository_info: {
          owner,
          repo,
          default_branch: repoInfo.default_branch,
        },
        status: shouldQueueSetup ? 'processing' : 'ready',
        is_new_repository: shouldQueueSetup,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        if (error.getStatus() === HttpStatus.CONFLICT) {
          this.logger.log(
            `📝 Duplicate repository in watchlist: ${dto.repo_url} (${dto.added_by})`,
          );
        } else {
          this.logger.error('Error adding to watchlist:', error.message);
        }
        throw error;
      }
      this.logger.error('Error adding to watchlist:', error.message);
      throw new HttpException(
        `Failed to add repository to watchlist: ${error.message}`,
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
        this.logger.log(`Created new user: ${userId}`);
      }

      return user;
    } catch (error) {
      this.logger.error('Error ensuring user exists:', error);
      throw new HttpException(
        `Failed to create/find user: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

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
        throw new HttpException(
          'Private repositories are not supported. Please use a public repository.',
          HttpStatus.FORBIDDEN,
        );
      }

      const isLargeRepo = this.isLargeRepository(repoData);

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
      if (error instanceof HttpException) {
        throw error;
      }

      if (error.message.includes('not found')) {
        throw new HttpException(
          'Repository not found on GitHub. Please check the URL and ensure the repository exists.',
          HttpStatus.NOT_FOUND,
        );
      }

      if (error.message.includes('rate limit exceeded')) {
        throw new HttpException(
          'GitHub API rate limit exceeded. Job will be retried in 1 hour.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      if (error.message.includes('forbidden')) {
        throw new HttpException(
          'Repository is private or access is restricted. Please ensure the repository is public or you have proper access.',
          HttpStatus.FORBIDDEN,
        );
      }

      if (error.message.includes('unauthorized')) {
        throw new HttpException(
          'GitHub authentication failed. Please check your GitHub token.',
          HttpStatus.UNAUTHORIZED,
        );
      }

      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new HttpException(
          'Unable to connect to GitHub. Please check your internet connection and try again.',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }

      throw new HttpException(
        `Failed to fetch repository info: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private isLargeRepository(repoData: any): boolean {
    const sizeMB = repoData.size / 124;
    const isLarge =
      repoData.stargazers_count > 100 ||
      sizeMB > 100 ||
      repoData.forks_count > 100;
    return isLarge;
  }

  async queueRepositorySetupJob(
    watchlistId: string,
    owner: string,
    repo: string,
    branch: string,
    isLargeRepo: boolean = false,
    repoSizeKB: number = 0,
    maxCommits?: number,
    forceLocalCloning?: boolean,
    forceLocalHealthAnalysis?: boolean,
  ): Promise<void> {
    try {
      const delay = isLargeRepo ? 0 : 0;

      await this.repositorySetupQueue.add(
        'clone-and-analyze',
        {
          watchlistId,
          owner,
          repo,
          branch,
          isLargeRepo,
          repoSizeKB,
          maxCommits,
          forceLocalCloning,
          forceLocalHealthAnalysis,
        },
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: 10,
          removeOnFail: 50,
        },
      );

      const options: string[] = [];
      if (forceLocalCloning) options.push('force-local-cloning');
      if (forceLocalHealthAnalysis) options.push('force-local-health');
      const optionsStr =
        options.length > 0 ? `, options: ${options.join(', ')}` : '';

      this.logger.log(
        `Queued repository setup job for ${owner}/${repo} (watchlist: ${watchlistId}, large: ${isLargeRepo}, size: ${repoSizeKB}KB, maxCommits: ${maxCommits || 'default'}${optionsStr})`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to queue repository setup job for ${owner}/${repo}:`,
        error,
      );
    }
  }

  async getWatchlistStatus(watchlistId: string) {
    try {
      const watchlist = await this.prisma.watchlist.findUnique({
        where: { watchlist_id: watchlistId },
        include: {
          package: true,
          userWatchlistEntries: {
            include: {
              user: true,
            },
          },
        },
      });

      if (!watchlist) {
        throw new HttpException('Watchlist not found', HttpStatus.NOT_FOUND);
      }

      return {
        watchlist_id: watchlist.watchlist_id,
        status: watchlist.status,
        processing_started_at: watchlist.processing_started_at,
        processing_completed_at: watchlist.processing_completed_at,
        last_error: watchlist.last_error,
        package: watchlist.package,
        user_watchlists: watchlist.userWatchlistEntries,
        updated_at: watchlist.updated_at,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        `Failed to get watchlist status: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async updateUserWatchlistAlerts(
    userWatchlistId: string,
    alerts: any,
  ): Promise<void> {
    await this.prisma.userWatchlist.update({
      where: { id: userWatchlistId },
      data: { alerts: JSON.stringify(alerts) },
    });
  }

  async removeFromWatchlist(userWatchlistId: string): Promise<void> {
    const userWatchlist = await this.prisma.userWatchlist.findUnique({
      where: { id: userWatchlistId },
      include: {
        user: true,
        watchlist: {
          include: {
            package: true,
          },
        },
      },
    });

    if (!userWatchlist) {
      throw new NotFoundException('User watchlist not found');
    }

    const userId = userWatchlist.user_id;
    const watchlistId = userWatchlist.watchlist_id;
    const packageId = userWatchlist.watchlist.package_id;

    const watchlistUserCount = await this.prisma.userWatchlist.count({
      where: { watchlist_id: watchlistId },
    });

    await this.prisma.userWatchlist.delete({
      where: { id: userWatchlistId },
    });

    if (watchlistUserCount === 1) {
      this.logger.log(
        `🧹 Cleaning up all data for watchlist ${watchlistId} as this was the only user watching it`,
      );

      await this.prisma.vulnerability.deleteMany({
        where: { watchlist_id: watchlistId },
      });

      await this.prisma.vulnerabilitySummary.deleteMany({
        where: { watchlist_id: watchlistId },
      });

      await this.prisma.repoStats.deleteMany({
        where: { watchlist_id: watchlistId },
      });

      await this.prisma.log.deleteMany({
        where: { watchlist_id: watchlistId },
      });

      await this.prisma.healthData.deleteMany({
        where: { watchlist_id: watchlistId },
      });

      await this.prisma.contributorStats.deleteMany({
        where: { watchlist_id: watchlistId },
      });

      await this.prisma.busFactorData.deleteMany({
        where: { watchlist_id: watchlistId },
      });

      await this.prisma.alertTriggered.deleteMany({
        where: { watchlist_id: watchlistId },
      });

      await this.prisma.aISummaryData.deleteMany({
        where: { watchlist_id: watchlistId },
      });

      await this.prisma.aIAnomaliesDetected.deleteMany({
        where: { watchlist_id: watchlistId },
      });

      await this.prisma.activityData.deleteMany({
        where: { watchlist_id: watchlistId },
      });

      await this.prisma.graphSnapshot.deleteMany({
        where: { repo_id: packageId },
      });

      const snapshotIds = await this.prisma.graphSnapshot.findMany({
        where: { repo_id: packageId },
        select: { snapshot_id: true },
      });

      if (snapshotIds.length > 0) {
        const snapshotIdList = snapshotIds.map((s) => s.snapshot_id);
        await this.prisma.graphNode.deleteMany({
          where: { snapshot_id: { in: snapshotIdList } },
        });
        await this.prisma.graphEdge.deleteMany({
          where: { snapshot_id: { in: snapshotIdList } },
        });
      }

      await this.prisma.buildTask.deleteMany({
        where: { repo_id: packageId },
      });

      const buildTaskIds = await this.prisma.buildTask.findMany({
        where: { repo_id: packageId },
        select: { task_id: true },
      });

      if (buildTaskIds.length > 0) {
        const taskIdList = buildTaskIds.map((t) => t.task_id);
        await this.prisma.buildSubtask.deleteMany({
          where: { task_id: { in: taskIdList } },
        });
      }

      await this.prisma.graphExport.deleteMany({
        where: { repo_id: packageId },
      });

      await this.prisma.weeklySummaryData.deleteMany({
        where: { watchlist_id: watchlistId },
      });

      await this.prisma.watchlistSbom.deleteMany({
        where: { watchlist_id: watchlistId },
      });

      await this.prisma.watchlist.delete({
        where: { watchlist_id: watchlistId },
      });
    }

    this.logger.log(
      `✅ Successfully removed repository ${userWatchlist.watchlist.package.repo_name} from watchlist for user ${userId}`,
    );
  }

  async triggerPollingJob(
    type: 'daily-poll' | 'poll-repo' = 'daily-poll',
    watchlistId?: string,
    owner?: string,
    repo?: string,
    branch?: string,
    delay: number = 0,
  ): Promise<void> {
    try {
      const jobData = {
        type,
        ...(watchlistId && { watchlistId }),
        ...(owner && { owner }),
        ...(repo && { repo }),
        ...(branch && { branch }),
      };

      let finalDelay = delay * 1000; // Convert seconds to milliseconds

      // For daily-poll, calculate delay to next midnight if no specific delay provided
      if (type === 'daily-poll' && delay === 0) {
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        finalDelay = tomorrow.getTime() - now.getTime();

        this.logger.log(
          `📅 Daily polling scheduled for ${tomorrow.toISOString()}`,
        );
      }

      await this.pollingQueue.add(type, jobData, {
        delay: finalDelay,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 10,
        removeOnFail: 50,
      });

      const delayHours = Math.round(finalDelay / (1000 * 60 * 60));
      this.logger.log(
        `✅ Polling job queued: ${type}${finalDelay > 0 ? ` (delayed by ${delayHours}h)` : ''}${watchlistId ? ` for watchlist ${watchlistId}` : ''}`,
      );
    } catch (error) {
      this.logger.error(`Failed to queue polling job:`, error);
      throw error;
    }
  }
}
