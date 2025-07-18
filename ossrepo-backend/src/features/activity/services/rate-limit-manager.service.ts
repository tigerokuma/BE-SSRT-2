import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface RateLimitStatus {
  limit: number;
  remaining: number;
  reset: Date;
  used: number;
  resetTime: number; // Unix timestamp
}

export interface ProcessingStrategy {
  useApiForCommits: boolean;
  useApiForLargeRepos: boolean;
  useLocalCloning: boolean;
  maxRepoSizeForCloning: number; // in KB
  reason: string;
}

@Injectable()
export class RateLimitManagerService {
  private readonly logger = new Logger(RateLimitManagerService.name);
  private readonly baseUrl: string;
  private readonly token: string | undefined;
  // No caching - always fetch fresh rate limit data

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService.get<string>('GITHUB_API_BASE_URL', 'https://api.github.com');
    this.token = this.configService.get<string>('GITHUB_TOKEN');
  }

  /**
   * Get current GitHub API rate limit status
   */
  async getRateLimitStatus(): Promise<RateLimitStatus> {
    try {
      const response = await fetch(`${this.baseUrl}/rate_limit`, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const rateLimit: RateLimitStatus = {
        limit: data.resources.core.limit,
        remaining: data.resources.core.remaining,
        reset: new Date(data.resources.core.reset * 1000),
        used: data.resources.core.used,
        resetTime: data.resources.core.reset,
      };

      // Only log rate limit when it's getting low
      if (rateLimit.remaining < 1000) {
        this.logger.log(`📊 Rate limit: ${rateLimit.remaining}/${rateLimit.limit} remaining (${rateLimit.used} used)`);
      }
      return rateLimit;
    } catch (error) {
      this.logger.error('Error fetching rate limit status:', error);
      
      // Return a conservative estimate if we can't fetch
      return {
        limit: 5000,
        remaining: 100, // Assume low remaining
        reset: new Date(Date.now() + 3600000), // 1 hour from now
        used: 4900,
        resetTime: Math.floor(Date.now() / 1000) + 3600,
      };
    }
  }

  /**
   * Determine the optimal processing strategy based on current rate limits
   */
  async getProcessingStrategy(): Promise<ProcessingStrategy> {
    const rateLimit = await this.getRateLimitStatus();
    const remaining = rateLimit.remaining;
    const limit = rateLimit.limit;
    const percentageUsed = (rateLimit.used / limit) * 100;

    // Only log strategy when it's not API-Heavy mode or when approaching limits
    if (remaining < 3000 || percentageUsed > 80) {
      this.logger.log(`🎯 Processing strategy: ${remaining}/${limit} remaining (${percentageUsed.toFixed(1)}% used)`);
    }

    // Phase 1: API-Heavy (0-60% used, 2000+ remaining)
    if (remaining >= 2000) {
      return {
        useApiForCommits: true,
        useApiForLargeRepos: true,
        useLocalCloning: false,
        maxRepoSizeForCloning: 0, // No cloning needed
        reason: `API-Heavy mode: ${remaining} requests remaining. Using GitHub API for all operations.`,
      };
    }

    // Phase 2: Hybrid (60-90% used, 500-2999 remaining)
    if (remaining >= 500) {
      return {
        useApiForCommits: true,
        useApiForLargeRepos: true,
        useLocalCloning: true,
        maxRepoSizeForCloning: 1000, // 1MB - clone smaller repos only
        reason: `Hybrid mode: ${remaining} requests remaining. Using API for large repos, cloning smaller repos.`,
      };
    }

    // Phase 3: API-Conservative (90%+ used, <500 remaining)
    return {
      useApiForCommits: false,
      useApiForLargeRepos: true,
      useLocalCloning: true,
      maxRepoSizeForCloning: 50000, // 50MB - clone more repos to save API calls
      reason: `API-Conservative mode: ${remaining} requests remaining. Minimal API usage, heavy local processing.`,
    };
  }

  /**
   * Check if we should use API for a specific repository based on size
   */
  async shouldUseApiForRepo(repoSizeKB: number): Promise<boolean> {
    const strategy = await this.getProcessingStrategy();
    
    if (!strategy.useLocalCloning) {
      return true; // Always use API in API-Heavy mode
    }

    if (strategy.useApiForLargeRepos && repoSizeKB > strategy.maxRepoSizeForCloning) {
      return true; // Use API for large repos in hybrid/conservative modes
    }

    return false; // Use local cloning for smaller repos
  }

  /**
   * Check if we should use API for commit fetching
   */
  async shouldUseApiForCommits(): Promise<boolean> {
    const strategy = await this.getProcessingStrategy();
    return strategy.useApiForCommits;
  }

  /**
   * Get time until rate limit reset
   */
  async getTimeUntilReset(): Promise<number> {
    const rateLimit = await this.getRateLimitStatus();
    const now = Math.floor(Date.now() / 1000);
    return Math.max(0, rateLimit.resetTime - now);
  }

  /**
   * Check if we're approaching rate limit (within 10% of limit)
   */
  async isApproachingLimit(): Promise<boolean> {
    const rateLimit = await this.getRateLimitStatus();
    const percentageUsed = (rateLimit.used / rateLimit.limit) * 100;
    return percentageUsed >= 90;
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