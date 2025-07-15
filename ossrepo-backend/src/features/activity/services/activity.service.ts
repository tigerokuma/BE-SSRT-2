import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AddToWatchlistDto } from '../dto/add-to-watchlist.dto';

@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async addToWatchlist(dto: AddToWatchlistDto) {
    try {
      // Extract owner and repo name from GitHub URL
      const { owner, repo } = this.parseGitHubUrl(dto.repo_url);
      
      // Fetch repository info from GitHub API
      const repoInfo = await this.fetchGitHubRepoInfo(owner, repo);
      
      // Ensure user exists (create if not)
      const user = await this.ensureUserExists(dto.added_by);
      
      // Generate unique IDs
      const packageName = `${owner}/${repo}`;
      const packageId = `package_${owner}_${repo}_${Date.now()}`;
      const watchlistId = `watchlist_${owner}_${repo}_${Date.now()}`;
      const userWatchlistId = `user_watchlist_${dto.added_by}_${watchlistId}`;
      
      // Create or update package entry (required for watchlist)
      const packageEntry = await this.prisma.package.upsert({
        where: { package_name: packageName },
        update: {
          // Update existing package if needed
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

      // Create watchlist entry
      const watchlistEntry = await this.prisma.watchlist.create({
        data: {
          watchlist_id: watchlistId,
          alert_cve_ids: [], // Leave blank as requested
          updated_at: new Date(),
          default_branch: repoInfo.default_branch,
          latest_commit_sha: undefined, // Leave blank for now
          commits_since_last_health_update: 0,
          package_id: packageEntry.package_id,
        },
      });

      // Create user_watchlist entry
      const userWatchlistEntry = await this.prisma.userWatchlist.create({
        data: {
          id: userWatchlistId,
          user_id: user.user_id,
          watchlist_id: watchlistId,
          added_at: new Date(),
          alerts: JSON.stringify(dto.alerts), // Store alerts as JSON string
          notes: dto.notes || null,
          created_at: new Date(),
        },
      });

      return {
        message: 'Repository successfully added to watchlist',
        user: user,
        package: packageEntry,
        watchlist: watchlistEntry,
        userWatchlist: userWatchlistEntry,
        repository_info: {
          owner,
          repo,
          default_branch: repoInfo.default_branch,
        },
      };
    } catch (error) {
      console.error('Error adding to watchlist:', error);
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
      const pathParts = urlObj.pathname.split('/').filter(Boolean);
      
      if (pathParts.length < 2) {
        throw new Error('Invalid GitHub repository URL');
      }
      
      const owner = pathParts[0];
      const repo = pathParts[1].replace('.git', '');
      
      return { owner, repo };
    } catch (error) {
      throw new HttpException(
        'Invalid GitHub repository URL',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private async fetchGitHubRepoInfo(owner: string, repo: string) {
    try {
      const response = await fetch(
        `${process.env.GITHUB_API_BASE_URL}/repos/${owner}/${repo}`,
        {
          headers: {
            'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
          },
        }
      );

      if (!response.ok) {
        if (response.status === 404) {
          throw new HttpException(
            'Repository not found on GitHub',
            HttpStatus.NOT_FOUND,
          );
        }
        throw new HttpException(
          `GitHub API error: ${response.statusText}`,
          HttpStatus.BAD_REQUEST,
        );
      }

      const repoData = await response.json();
      
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
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        `Failed to fetch repository info: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
} 