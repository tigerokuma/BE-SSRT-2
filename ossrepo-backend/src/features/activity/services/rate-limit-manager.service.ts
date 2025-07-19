import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Rate Limit Manager Service
 * 
 * This service implements a token-based strategy for efficient GitHub API usage.
 * The strategy scales repository cloning thresholds based on available API tokens:
 * 
 * Token-Based Strategy:
 * - < 50MB repos: Always cloned (regardless of tokens)
 * - 4000+ tokens: Clone repos < 100MB (use API for larger repos)
 * - 3000+ tokens: Clone repos < 250MB
 * - 2000+ tokens: Clone repos < 500MB
 * - 1000+ tokens: Clone repos < 1GB
 * - < 1000 tokens: Clone repos < 50MB (only very small repos)
 * 
 * This approach:
 * 1. Preserves API tokens for essential operations
 * 2. Uses local cloning for smaller repos (faster and more reliable)
 * 3. Scales API usage based on available tokens
 * 4. Prevents hitting rate limits during high-volume processing
 * 
 * Flow for Repository Processing:
 * 1. Check available tokens
 * 2. Determine cloning threshold based on tokens
 * 3. For repos smaller than threshold: Use local cloning
 * 4. For repos larger than threshold: Use GitHub API
 * 5. Fall back to local cloning if API fails
 */
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
   * New token-based strategy for more efficient API usage
   */
  async getProcessingStrategy(): Promise<ProcessingStrategy> {
    const rateLimit = await this.getRateLimitStatus();
    const remaining = rateLimit.remaining;
    const limit = rateLimit.limit;
    const percentageUsed = (rateLimit.used / limit) * 100;

    // Log strategy when approaching limits or when it's not the default API-Heavy mode
    if (remaining < 4000 || percentageUsed > 80) {
      this.logger.log(`🎯 Processing strategy: ${remaining}/${limit} remaining (${percentageUsed.toFixed(1)}% used)`);
    }

    // New token-based strategy for more efficient API usage
    // Always clone repositories under 50MB regardless of tokens
    const baseCloningThreshold = 50000; // 50MB in KB

    // Token-based scaling for larger repositories
    let maxRepoSizeForCloning = baseCloningThreshold;
    let useApiForCommits = true;
    let useApiForLargeRepos = true;
    let useLocalCloning = true;
    let reason = '';

    if (remaining >= 4000) {
      // 4000+ tokens: Clone repos < 100MB, use API for larger repos (fast API for large repos)
      maxRepoSizeForCloning = 100000; // 100MB
      reason = `Token-Heavy mode: ${remaining} tokens remaining. Cloning repos < 100MB, using API for larger repos.`;
    } else if (remaining >= 3000) {
      // 3000+ tokens: Clone repos < 250MB, use API for larger repos
      maxRepoSizeForCloning = 250000; // 250MB
      reason = `High-Token mode: ${remaining} tokens remaining. Cloning repos < 250MB, using API for larger repos.`;
    } else if (remaining >= 2000) {
      // 2000+ tokens: Clone repos < 500MB, use API for larger repos
      maxRepoSizeForCloning = 500000; // 500MB
      reason = `Medium-Token mode: ${remaining} tokens remaining. Cloning repos < 500MB, using API for larger repos.`;
    } else if (remaining >= 1000) {
      // 1000+ tokens: Clone repos < 1GB, use API for larger repos
      maxRepoSizeForCloning = 1000000; // 1GB
      reason = `Low-Token mode: ${remaining} tokens remaining. Cloning repos < 1GB, using API for larger repos.`;
    } else {
      // <1000 tokens: Conservative mode - clone only very small repos, preserve tokens
      maxRepoSizeForCloning = baseCloningThreshold; // 50MB
      useApiForCommits = false; // Don't use API for commits when tokens are very low
      reason = `Conservative mode: ${remaining} tokens remaining. Cloning repos < 50MB, minimal API usage.`;
    }

    return {
      useApiForCommits,
      useApiForLargeRepos,
      useLocalCloning,
      maxRepoSizeForCloning,
      reason,
    };
  }

  /**
   * Get a summary of the current token strategy and cloning thresholds
   * Useful for debugging and monitoring
   */
  async getTokenStrategySummary(): Promise<{
    remainingTokens: number;
    totalTokens: number;
    percentageUsed: number;
    cloningThresholdKB: number;
    cloningThresholdMB: number;
    strategy: string;
    shouldUseApiForCommits: boolean;
  }> {
    const rateLimit = await this.getRateLimitStatus();
    const remaining = rateLimit.remaining;
    const limit = rateLimit.limit;
    const percentageUsed = (rateLimit.used / limit) * 100;
    const cloningThreshold = this.getCloningThresholdForTokens(remaining);
    
    let strategy = '';
    if (remaining >= 4000) {
      strategy = 'Token-Heavy (4000+ tokens remaining)';
    } else if (remaining >= 3000) {
      strategy = 'High-Token (3000+ tokens remaining)';
    } else if (remaining >= 2000) {
      strategy = 'Medium-Token (2000+ tokens remaining)';
    } else if (remaining >= 1000) {
      strategy = 'Low-Token (1000+ tokens remaining)';
    } else {
      strategy = 'Conservative (<1000 tokens remaining)';
    }
    
    return {
      remainingTokens: remaining,
      totalTokens: limit,
      percentageUsed: Math.round(percentageUsed * 100) / 100,
      cloningThresholdKB: cloningThreshold,
      cloningThresholdMB: Math.round(cloningThreshold / 1024 * 100) / 100,
      strategy,
      shouldUseApiForCommits: remaining >= 1000,
    };
  }

  /**
   * Get the repository size threshold for cloning based on available tokens
   * This implements the new token-based strategy for more efficient API usage
   * With more tokens, we use API for larger repos (fast), with fewer tokens we clone more repos (slow but saves API calls)
   */
  private getCloningThresholdForTokens(remainingTokens: number): number {
    // Always clone repositories under 50MB regardless of tokens
    const baseCloningThreshold = 50000; // 50MB in KB

    if (remainingTokens >= 4000) {
      return 100000; // 100MB - clone repos < 100MB (use API for larger repos)
    } else if (remainingTokens >= 3000) {
      return 250000; // 250MB - clone repos < 250MB
    } else if (remainingTokens >= 2000) {
      return 500000; // 500MB - clone repos < 500MB
    } else if (remainingTokens >= 1000) {
      return 1000000; // 1GB - clone repos < 1GB
    } else {
      return baseCloningThreshold; // 50MB - clone repos < 50MB (only very small repos)
    }
  }

  /**
   * Check if we should use API for a specific repository based on size
   * Uses the new token-based strategy for more efficient API usage
   */
  async shouldUseApiForRepo(repoSizeKB: number): Promise<boolean> {
    const rateLimit = await this.getRateLimitStatus();
    const remaining = rateLimit.remaining;
    
    // Get the cloning threshold based on available tokens
    const cloningThreshold = this.getCloningThresholdForTokens(remaining);
    
    // Use API if repository is larger than the cloning threshold
    // This means we'll clone smaller repos and use API for larger ones
    const shouldUseApi = repoSizeKB >= cloningThreshold;
    
    // Debug logging to understand the decision
    this.logger.log(`🔍 Repo decision: ${repoSizeKB}KB >= ${cloningThreshold}KB = ${shouldUseApi} (tokens: ${remaining})`);
    
    // Only log when we're using API (local cloning is the default)
    if (shouldUseApi) {
      this.logger.log(`📡 Using GitHub API for ${repoSizeKB}KB repo (threshold: ${cloningThreshold}KB, tokens: ${remaining})`);
    }
    
    return shouldUseApi;
  }

  /**
   * Check if we should use API for commit fetching
   * Uses the new token-based strategy - only use API when we have sufficient tokens
   */
  async shouldUseApiForCommits(): Promise<boolean> {
    const rateLimit = await this.getRateLimitStatus();
    const remaining = rateLimit.remaining;
    
    // Use API for commits only when we have at least 1000 tokens
    // This prevents us from running out of tokens for essential operations
    const shouldUseApi = remaining >= 1000;
    
    // Only log when we're using API (local cloning is the default)
    if (shouldUseApi) {
      this.logger.log(`📡 Using GitHub API for commits (tokens: ${remaining} >= 1000)`);
    }
    
    return shouldUseApi;
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