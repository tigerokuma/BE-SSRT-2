import { Injectable, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AddToWatchlistDto } from '../dto/add-to-watchlist.dto';
import { GitHubApiService } from './github-api.service';

@Injectable()
export class ActivityService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('repository-setup')
    private readonly repositorySetupQueue: Queue,
    private readonly githubApiService: GitHubApiService,
  ) {}

  async addToWatchlist(dto: AddToWatchlistDto) {
    try {
      // Extract owner and repo name from GitHub URL
      const { owner, repo } = this.parseGitHubUrl(dto.repo_url);

      // Fetch repository info from GitHub API
      const repoInfo = await this.fetchGitHubRepoInfo(owner, repo);

      // Ensure user exists (create if not)
      const user = await this.ensureUserExists(dto.added_by);

      // Generate package name for lookup
      const packageName = `${owner}/${repo}`;

      // Check if package already exists in watchlist
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
        // Repository already exists in watchlist
        const existingWatchlist = existingPackage.watchlists[0];

        // Check if user is already watching this repository
        if (existingWatchlist.userWatchlistEntries.length > 0) {
          throw new HttpException(
            'You are already watching this repository',
            HttpStatus.CONFLICT,
          );
        }

        // User is not watching, add them to existing watchlist
        watchlistEntry = existingWatchlist;

        // Create user_watchlist entry for existing watchlist
        const userWatchlistId = `user_watchlist_${dto.added_by}_${existingWatchlist.watchlist_id}`;
        userWatchlistEntry = await this.prisma.userWatchlist.create({
          data: {
            id: userWatchlistId,
            user_id: user.user_id,
            watchlist_id: existingWatchlist.watchlist_id,
            added_at: new Date(),
            alerts: JSON.stringify(dto.alerts),
            notes: dto.notes || null,
            created_at: new Date(),
          },
        });

        // No need to queue setup job since repo already exists
        shouldQueueSetup = false;
      } else {
        // Repository is new, create everything from scratch
        const packageId = `package_${owner}_${repo}_${Date.now()}`;
        const watchlistId = `watchlist_${owner}_${repo}_${Date.now()}`;
        const userWatchlistId = `user_watchlist_${dto.added_by}_${watchlistId}`;

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

        // Create user_watchlist entry
        userWatchlistEntry = await this.prisma.userWatchlist.create({
          data: {
            id: userWatchlistId,
            user_id: user.user_id,
            watchlist_id: watchlistId,
            added_at: new Date(),
            alerts: JSON.stringify(dto.alerts),
            notes: dto.notes || null,
            created_at: new Date(),
          },
        });

        // Queue background job for repository setup
        shouldQueueSetup = true;
      }

      // Queue setup job only for new repositories
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
        // Log user-friendly message for expected errors
        if (error.getStatus() === HttpStatus.CONFLICT) {
          console.log(
            `📝 Duplicate repository in watchlist: ${dto.repo_url} (${dto.added_by})`,
          );
        } else {
          console.error('Error adding to watchlist:', error.message);
        }
        throw error;
      }
      console.error('Error adding to watchlist:', error.message);
      throw new HttpException(
        `Failed to add repository to watchlist: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private async ensureUserExists(userId: string) {
    try {
      // Try to find existing user
      let user = await this.prisma.user.findUnique({
        where: { user_id: userId },
      });

      // If user doesn't exist, create a new one
      if (!user) {
        user = await this.prisma.user.create({
          data: {
            user_id: userId,
            email: `${userId}@example.com`, // Placeholder email
            name: userId, // Use userId as name
          },
        });
        console.log(`Created new user: ${userId}`);
      }

      return user;
    } catch (error) {
      console.error('Error ensuring user exists:', error);
      throw new HttpException(
        `Failed to create/find user: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private parseGitHubUrl(url: string): { owner: string; repo: string } {
    try {
      const urlObj = new URL(url);

      // Validate it's actually a GitHub URL
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

      // Basic validation
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

      // Check if repository is private
      if (repoData.private) {
        throw new HttpException(
          'Private repositories are not supported. Please use a public repository.',
          HttpStatus.FORBIDDEN,
        );
      }

      // Determine if this is a large repository
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
        size: repoData.size, // Size in KB
        is_large_repo: isLargeRepo,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      // Handle specific GitHub API errors
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

      // Handle network errors
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

  /**
   * Determine if a repository is considered "large basedon various metrics
   */
  private isLargeRepository(repoData: any): boolean {
    // Large repos typically have:
    // - High star count (>100)
    // - Large size (>100 MB)
    // - Many forks (>100)
    // - High commit frequency

    const sizeMB = repoData.size / 124; // Convert KB to MB
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
      const delay = isLargeRepo ? 0 : 0; // No delay for now, but could add delays for large repos

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

      console.log(
        `Queued repository setup job for ${owner}/${repo} (watchlist: ${watchlistId}, large: ${isLargeRepo}, size: ${repoSizeKB}KB, maxCommits: ${maxCommits || 'default'}${optionsStr})`,
      );
    } catch (error) {
      console.error(
        `Failed to queue repository setup job for ${owner}/${repo}:`,
        error,
      );
      // Don't throw error here as the watchlist entry was already created
      // The job can be retried manually if needed
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

  async updateUserWatchlistAlerts(userWatchlistId: string, alerts: any): Promise<void> {
    await this.prisma.userWatchlist.update({
      where: { id: userWatchlistId },
      data: { alerts: JSON.stringify(alerts) }
    })
  }

  async removeFromWatchlist(userWatchlistId: string): Promise<void> {
    // First, get the user watchlist to check if it's the only one for this user
    const userWatchlist = await this.prisma.userWatchlist.findUnique({
      where: { id: userWatchlistId },
      include: {
        user: true,
        watchlist: {
          include: {
            package: true
          }
        }
      }
    })

    if (!userWatchlist) {
      throw new NotFoundException('User watchlist not found')
    }

    const userId = userWatchlist.user_id
    const watchlistId = userWatchlist.watchlist_id

    // Check if this is the only repository being watched by this user
    const userWatchlistCount = await this.prisma.userWatchlist.count({
      where: { user_id: userId }
    })

    // Delete the specific user watchlist entry
    await this.prisma.userWatchlist.delete({
      where: { id: userWatchlistId }
    })

    // If this was the only repository being watched, clean up all related data
    if (userWatchlistCount === 1) {
      console.log(`🧹 Cleaning up all data for user ${userId} as this was their only watched repository`)

      // Delete all logs for this watchlist
      await this.prisma.log.deleteMany({
        where: { watchlist_id: watchlistId }
      })

      // Delete all health data for this watchlist
      await this.prisma.healthData.deleteMany({
        where: { watchlist_id: watchlistId }
      })

      // Delete all contributor stats for this watchlist
      await this.prisma.contributorStats.deleteMany({
        where: { watchlist_id: watchlistId }
      })

      // Delete all repository stats for this watchlist
      await this.prisma.repoStats.deleteMany({
        where: { watchlist_id: watchlistId }
      })

      // Delete all graph snapshots for this watchlist (using repo_id which should match package_id)
      await this.prisma.graphSnapshot.deleteMany({
        where: { repo_id: userWatchlist.watchlist.package_id }
      })

      // Delete all alert triggers for this user watchlist (Alert model doesn't exist, only AlertTriggered)
      await this.prisma.alertTriggered.deleteMany({
        where: { user_watchlist_id: userWatchlistId }
      })

      // Delete all alert triggers for this user watchlist
      await this.prisma.alertTriggered.deleteMany({
        where: { user_watchlist_id: userWatchlistId }
      })

      // Delete the watchlist itself
      await this.prisma.watchlist.delete({
        where: { watchlist_id: watchlistId }
      })

      // Delete the user itself
      await this.prisma.user.delete({
        where: { user_id: userId }
      })
    }

    console.log(`✅ Successfully removed repository ${userWatchlist.watchlist.package.repo_name} from watchlist for user ${userId}`)
  }
}
