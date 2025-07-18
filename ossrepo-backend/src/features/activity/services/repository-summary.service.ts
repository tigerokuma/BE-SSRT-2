import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AISummaryService, RepositoryData, AISummaryResult } from './ai-summary.service';
import { GitHubApiService } from './github-api.service';
import { BusFactorService } from './bus-factor.service';

@Injectable()
export class RepositorySummaryService {
  private readonly logger = new Logger(RepositorySummaryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiSummaryService: AISummaryService,
    private readonly githubApiService: GitHubApiService,
    private readonly busFactorService: BusFactorService,
  ) {}

  async generateSummaryForRepository(
    owner: string,
    repo: string,
    watchlistId: string
  ): Promise<AISummaryResult | null> {
    try {
      this.logger.log(`🤖 Generating AI summary for ${owner}/${repo}`);

      // Collect comprehensive repository data
      const repoData = await this.collectRepositoryData(owner, repo, watchlistId);
      
      if (!repoData) {
        this.logger.warn(`Could not collect data for ${owner}/${repo}`);
        return null;
      }

      // Generate AI summary
      const summary = await this.aiSummaryService.generateRepositorySummary(repoData);
      
      this.logger.log(`✅ Generated summary for ${owner}/${repo}: "${summary.summary.substring(0, 50)}..."`);
      
      // For now, we'll just return the summary
      // Later when we add the database fields, we can store it
      return summary;
      
    } catch (error) {
      this.logger.error(`Failed to generate summary for ${owner}/${repo}:`, error);
      return null;
    }
  }

  async generateSummaryWithData(repoData: RepositoryData): Promise<AISummaryResult | null> {
    try {
      this.logger.log(`🤖 Generating AI summary with provided data for ${repoData.name}`);

      // Generate AI summary using the provided data (no API calls)
      const summary = await this.aiSummaryService.generateRepositorySummary(repoData);
      
      this.logger.log(`✅ Generated summary for ${repoData.name}: "${summary.summary.substring(0, 50)}..."`);
      
      return summary;
      
    } catch (error) {
      this.logger.error(`Failed to generate summary for ${repoData.name}:`, error);
      return null;
    }
  }

  private async collectRepositoryData(owner: string, repo: string, watchlistId: string): Promise<RepositoryData | null> {
    try {
      // Get basic repository info from GitHub API
      const repoInfo = await this.githubApiService.getRepositoryInfo(owner, repo);
      
      // Get recent commits
      const recentCommits = await this.getRecentCommits(owner, repo);
      
      // Get README content
      const readmeContent = await this.getReadmeContent(owner, repo);
      
      // Calculate bus factor using watchlist ID
      const busFactorResult = await this.busFactorService.calculateBusFactor(watchlistId);
      
      // Get commit count (approximate)
      const commitCount = await this.getCommitCount(owner, repo);

      const repoData: RepositoryData = {
        name: `${owner}/${repo}`,
        description: repoInfo.description,
        stars: repoInfo.stargazers_count,
        forks: repoInfo.forks_count,
        contributors: busFactorResult.totalContributors,
        language: undefined, // Not available in current GitHubRepoInfo
        topics: [], // Not available in current GitHubRepoInfo
        lastCommitDate: repoInfo.pushed_at ? new Date(repoInfo.pushed_at) : undefined,
        commitCount: commitCount,
        busFactor: busFactorResult.busFactor,
        riskScore: undefined, // Not available in current GitHubRepoInfo
        readmeContent: readmeContent,
        recentCommits: recentCommits,
      };

      return repoData;
    } catch (error) {
      this.logger.error(`Failed to collect repository data for ${owner}/${repo}:`, error);
      return null;
    }
  }

  private async getRecentCommits(owner: string, repo: string): Promise<Array<{
    message: string;
    author: string;
    date: Date;
    filesChanged: number;
  }>> {
    try {
      const commits = await this.githubApiService.getLatestCommits(owner, repo, 'main', 5);
      
      return commits.map(commit => ({
        message: commit.commit.message,
        author: commit.commit.author.name,
        date: new Date(commit.commit.author.date),
        filesChanged: 0, // GitHub API doesn't provide files in basic commit response
      }));
    } catch (error) {
      this.logger.warn(`Could not fetch recent commits for ${owner}/${repo}:`, error);
      return [];
    }
  }

  private async getReadmeContent(owner: string, repo: string): Promise<string | undefined> {
    try {
      // For now, we'll skip README content as it requires additional GitHub API calls
      // This can be implemented later when we add the method to GitHubApiService
      this.logger.log(`📝 README content fetching not yet implemented for ${owner}/${repo}`);
      return undefined;
    } catch (error) {
      this.logger.warn(`Could not fetch README for ${owner}/${repo}:`, error);
      return undefined;
    }
  }

  private async getCommitCount(owner: string, repo: string): Promise<number | undefined> {
    try {
      // This is a simplified approach - in a real implementation,
      // you might want to use GitHub's GraphQL API for more accurate counts
      const commits = await this.githubApiService.getLatestCommits(owner, repo, 'main', 100);
      return commits.length;
    } catch (error) {
      this.logger.warn(`Could not get commit count for ${owner}/${repo}:`, error);
      return undefined;
    }
  }

  private cleanMarkdown(content: string): string {
    // Remove markdown formatting for better AI processing
    return content
      .replace(/#{1,6}\s+/g, '') // Remove headers
      .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold
      .replace(/\*(.*?)\*/g, '$1') // Remove italic
      .replace(/`(.*?)`/g, '$1') // Remove inline code
      .replace(/```[\s\S]*?```/g, '') // Remove code blocks
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Remove links, keep text
      .replace(/\n+/g, ' ') // Replace multiple newlines with space
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .trim();
  }

  async testSummaryGeneration(owner: string, repo: string): Promise<{
    success: boolean;
    summary?: AISummaryResult;
    error?: string;
  }> {
    try {
      this.logger.log(`🧪 Testing summary generation for ${owner}/${repo}`);
      
      const summary = await this.generateSummaryForRepository(owner, repo, 'test-watchlist-id');
      
      if (summary) {
        return {
          success: true,
          summary,
        };
      } else {
        return {
          success: false,
          error: 'Failed to generate summary',
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
} 