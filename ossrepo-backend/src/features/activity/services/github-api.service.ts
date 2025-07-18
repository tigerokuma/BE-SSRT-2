import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RateLimitManagerService } from './rate-limit-manager.service';

export interface GitHubCommit {
  sha: string;
  commit: {
    author: {
      name: string;
      email: string;
      date: string;
    };
    committer: {
      name: string;
      email: string;
      date: string;
    };
    message: string;
  };
  author?: {
    login: string;
    id: number;
  };
  committer?: {
    login: string;
    id: number;
  };
  parents: Array<{ sha: string }>;
}

export interface GitHubRepoInfo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  description: string;
  fork: boolean;
  size: number; // Size in KB
  stargazers_count: number;
  watchers_count: number;
  forks_count: number;
  default_branch: string;
  created_at: string;
  updated_at: string;
  pushed_at: string;
}

@Injectable()
export class GitHubApiService {
  private readonly logger = new Logger(GitHubApiService.name);
  private readonly baseUrl: string;
  private readonly token: string | undefined;

  constructor(
    private readonly configService: ConfigService,
    private readonly rateLimitManager: RateLimitManagerService,
  ) {
    this.baseUrl = this.configService.get<string>('GITHUB_API_BASE_URL', 'https://api.github.com');
    this.token = this.configService.get<string>('GITHUB_TOKEN');
  }

  /**
   * Fetch commits from GitHub API
   */
  async getCommits(
    owner: string, 
    repo: string, 
    branch: string = 'main', 
    since?: string, 
    perPage: number = 100,
    maxPages: number = 10
  ): Promise<GitHubCommit[]> {
    try {
      const commits: GitHubCommit[] = [];
      let page = 1;
      let hasMorePages = true;

      // No logging for API calls to reduce noise

      while (hasMorePages && page <= maxPages) {
        const url = new URL(`${this.baseUrl}/repos/${owner}/${repo}/commits`);
        url.searchParams.set('sha', branch);
        url.searchParams.set('per_page', perPage.toString());
        url.searchParams.set('page', page.toString());
        
        if (since) {
          url.searchParams.set('since', since);
        }

        const response = await fetch(url.toString(), {
          headers: this.getHeaders(),
        });

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error(`Repository ${owner}/${repo} not found`);
          }
          if (response.status === 403) {
            const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
            if (rateLimitRemaining === '0') {
              throw new Error('GitHub API rate limit exceeded');
            }
            throw new Error('Repository access forbidden');
          }
          throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
        }

        const pageCommits = await response.json();
        
        if (pageCommits.length === 0) {
          hasMorePages = false;
        } else {
          commits.push(...pageCommits);
          page++;
        }

        // Check rate limit headers
        const remaining = response.headers.get('x-ratelimit-remaining');
        if (remaining && parseInt(remaining) < 100) {
          this.logger.warn(`⚠️ Rate limit getting low: ${remaining} remaining`);
          break;
        }
      }

      // No logging to reduce noise
      return commits;
    } catch (error) {
      this.logger.error(`❌ Error fetching commits from GitHub API for ${owner}/${repo}:`, error.message);
      throw error;
    }
  }

  /**
   * Get repository information
   */
  async getRepositoryInfo(owner: string, repo: string): Promise<GitHubRepoInfo> {
    try {
      const response = await fetch(
        `${this.baseUrl}/repos/${owner}/${repo}`,
        {
          headers: this.getHeaders(),
        }
      );

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Repository ${owner}/${repo} not found`);
        }
        if (response.status === 403) {
          const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
          if (rateLimitRemaining === '0') {
            throw new Error('GitHub API rate limit exceeded');
          }
          throw new Error('Repository access forbidden');
        }
        throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
      }

      const repoData = await response.json();
      return repoData as GitHubRepoInfo;
    } catch (error) {
      this.logger.error(`❌ Error fetching repository info for ${owner}/${repo}:`, error.message);
      throw error;
    }
  }

  /**
   * Get latest commits (up to maxCommits) without date filtering
   */
  async getLatestCommits(owner: string, repo: string, branch: string = 'main', maxCommits: number = 2000): Promise<GitHubCommit[]> {
    try {
      // Use optimized pagination for better performance
      const maxPages = Math.ceil(maxCommits / 100);
      const commits = await this.getCommits(
        owner, 
        repo, 
        branch, 
        undefined, // No date filtering - get all commits
        100, // per page (GitHub max)
        maxPages
      );

      // Limit to requested number of commits
      return commits.slice(0, maxCommits);
    } catch (error) {
      this.logger.error(`❌ Error fetching latest commits for ${owner}/${repo}:`, error.message);
      throw error;
    }
  }

  /**
   * Get commits from the last 2 years with optimized pagination
   * @deprecated Use getLatestCommits instead for consistent behavior
   */
  async getCommitsFromLastTwoYears(owner: string, repo: string, branch: string = 'main', maxCommits: number = 2000): Promise<GitHubCommit[]> {
    try {
      const twoYearsAgo = new Date();
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
      
      // Use optimized pagination for better performance
      const maxPages = Math.ceil(maxCommits / 100);
      const commits = await this.getCommits(
        owner, 
        repo, 
        branch, 
        twoYearsAgo.toISOString(),
        100, // per page (GitHub max)
        maxPages
      );

      // Limit to requested number of commits
      return commits.slice(0, maxCommits);
    } catch (error) {
      this.logger.error(`❌ Error fetching commits from last 2 years for ${owner}/${repo}:`, error.message);
      throw error;
    }
  }

  /**
   * Check if repository is accessible
   */
  async isRepositoryAccessible(owner: string, repo: string): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.baseUrl}/repos/${owner}/${repo}`,
        {
          headers: this.getHeaders(),
          method: 'HEAD', // Just check if it exists
        }
      );

      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get headers for GitHub API requests
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'OSS-Repository-Backend',
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    return headers;
  }
} 