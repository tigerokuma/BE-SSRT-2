import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
  size: number;
  stargazers_count: number;
  watchers_count: number;
  forks_count: number;
  default_branch: string;
  created_at: string;
  updated_at: string;
  pushed_at: string;
}

export interface GitHubContributorStats {
  author: {
    login: string;
    id: number;
    avatar_url: string;
    type: string;
  };
  total: number;
  weeks: Array<{
    w: number;
    a: number;
    d: number;
    c: number;
  }>;
}

@Injectable()
export class GitHubApiService {
  private readonly logger = new Logger(GitHubApiService.name);
  private readonly baseUrl: string;
  private readonly token: string | undefined;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService.get<string>(
      'GITHUB_API_BASE_URL',
      'https://api.github.com',
    );
    this.token = this.configService.get<string>('GITHUB_TOKEN');
    
    // Debug logging
    this.logger.log(`🔑 GitHub API Service initialized`);
    this.logger.log(`🌐 Base URL: ${this.baseUrl}`);
    this.logger.log(`🔐 Token present: ${!!this.token}`);
    this.logger.log(`🔐 Token preview: ${this.token ? this.token.substring(0, 10) + '...' : 'None'}`);
    
    // Check if GITHUB_TOKEN is in process.env
    const envToken = process.env.GITHUB_TOKEN;
    this.logger.log(`🔍 Process.env.GITHUB_TOKEN present: ${!!envToken}`);
    this.logger.log(`🔍 Process.env.GITHUB_TOKEN preview: ${envToken ? envToken.substring(0, 10) + '...' : 'None'}`);
  }

  async getCommits(
    owner: string,
    repo: string,
    branch: string = 'main',
    since?: string,
    perPage: number = 100,
    maxPages: number = 10,
  ): Promise<GitHubCommit[]> {
    try {
      const commits: GitHubCommit[] = [];
      let page = 1;
      let hasMorePages = true;

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
            const rateLimitRemaining = response.headers.get(
              'x-ratelimit-remaining',
            );
            if (rateLimitRemaining === '0') {
              throw new Error('GitHub API rate limit exceeded');
            }
            throw new Error('Repository access forbidden');
          }
          throw new Error(
            `GitHub API error: ${response.status} ${response.statusText}`,
          );
        }

        const pageCommits = (await response.json()) as GitHubCommit[];

        if (pageCommits.length === 0) {
          hasMorePages = false;
        } else {
          commits.push(...pageCommits);
          page++;
        }

        const remaining = response.headers.get('x-ratelimit-remaining');
        if (remaining && parseInt(remaining) < 100) {
          this.logger.warn(`⚠️ Rate limit getting low: ${remaining} remaining`);
          break;
        }
      }

      return commits;
    } catch (error) {
      this.logger.error(
        `❌ Error fetching commits from GitHub API for ${owner}/${repo}:`,
        error.message,
      );
      throw error;
    }
  }

  async getRepositoryInfo(
    owner: string,
    repo: string,
  ): Promise<GitHubRepoInfo> {
    try {
      const response = await fetch(`${this.baseUrl}/repos/${owner}/${repo}`, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Repository ${owner}/${repo} not found`);
        }
        if (response.status === 403) {
          const rateLimitRemaining = response.headers.get(
            'x-ratelimit-remaining',
          );
          if (rateLimitRemaining === '0') {
            throw new Error('GitHub API rate limit exceeded');
          }
          throw new Error('Repository access forbidden');
        }
        throw new Error(
          `GitHub API error: ${response.status} ${response.statusText}`,
        );
      }

      const repoData = (await response.json()) as GitHubRepoInfo;
      return repoData;
    } catch (error) {
      this.logger.error(
        `❌ Error fetching repository info for ${owner}/${repo}:`,
        error.message,
      );
      throw error;
    }
  }

  async getLatestCommits(
    owner: string,
    repo: string,
    branch: string = 'main',
    maxCommits: number = 2000,
  ): Promise<GitHubCommit[]> {
    try {
      const maxPages = Math.ceil(maxCommits / 100);
      const commits = await this.getCommits(
        owner,
        repo,
        branch,
        undefined,
        100,
        maxPages,
      );

      return commits.slice(0, maxCommits);
    } catch (error) {
      this.logger.error(
        `❌ Error fetching latest commits for ${owner}/${repo}:`,
        error.message,
      );
      throw error;
    }
  }

  async isRepositoryAccessible(owner: string, repo: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/repos/${owner}/${repo}`, {
        headers: this.getHeaders(),
        method: 'HEAD',
      });

      return response.ok;
    } catch (error) {
      return false;
    }
  }

  async getPackageJson(owner: string, repo: string): Promise<any> {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/package.json`;
    this.logger.log(`📦 Fetching package.json from GitHub API: ${url}`);
    
    const response = await fetch(url, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      this.logger.log(`⚠️ Could not fetch package.json: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();
    
    // Decode base64 content
    if (data.content) {
      const content = Buffer.from(data.content, 'base64').toString('utf-8');
      const packageJson = JSON.parse(content);
      this.logger.log(`✅ Fetched package.json with ${Object.keys(packageJson.dependencies || {}).length} dependencies`);
      return packageJson;
    }
    
    return null;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'OSS-Repository-Backend',
    };

    if (this.token) {
      headers['Authorization'] = `token ${this.token}`;
      this.logger.log(`🔐 Using GitHub token for API calls`);
    } else {
      this.logger.warn(`⚠️ No GitHub token available - API calls may be rate limited`);
    }

    return headers;
  }
}
