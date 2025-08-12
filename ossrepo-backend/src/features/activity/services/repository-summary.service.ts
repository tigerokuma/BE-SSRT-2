import { Injectable, Logger } from '@nestjs/common';
import {
  AISummaryService,
  RepositoryData,
  AISummaryResult,
} from './ai-summary.service';
import { GitHubApiService } from './github-api.service';
import { BusFactorService } from './bus-factor.service';

@Injectable()
export class RepositorySummaryService {
  private readonly logger = new Logger(RepositorySummaryService.name);

  constructor(
    private readonly aiSummaryService: AISummaryService,
    private readonly githubApiService: GitHubApiService,
    private readonly busFactorService: BusFactorService,
  ) {}

  async generateSummaryForRepository(
    owner: string,
    repo: string,
    watchlistId: string,
  ): Promise<AISummaryResult | null> {
    try {
      this.logger.log(`🤖 Generating AI summary for ${owner}/${repo}`);

      const repoData = await this.collectRepositoryData(
        owner,
        repo,
        watchlistId,
      );

      if (!repoData) {
        this.logger.warn(`Could not collect data for ${owner}/${repo}`);
        return null;
      }

      const summary =
        await this.aiSummaryService.generateRepositorySummary(repoData);

      this.logger.log(
        `✅ Generated summary for ${owner}/${repo}: "${summary.summary.substring(0, 50)}..."`,
      );

      return summary;
    } catch (error) {
      this.logger.error(
        `Failed to generate summary for ${owner}/${repo}:`,
        error,
      );
      return null;
    }
  }

  async generateSummaryWithData(
    repoData: RepositoryData,
  ): Promise<AISummaryResult | null> {
    try {
      this.logger.log(
        `🤖 Generating AI summary with provided data for ${repoData.name}`,
      );

      const summary =
        await this.aiSummaryService.generateRepositorySummary(repoData);

      this.logger.log(
        `✅ Generated summary for ${repoData.name}: "${summary.summary.substring(0, 50)}..."`,
      );

      return summary;
    } catch (error) {
      this.logger.error(
        `Failed to generate summary for ${repoData.name}:`,
        error,
      );
      return null;
    }
  }

  private async collectRepositoryData(
    owner: string,
    repo: string,
    watchlistId: string,
  ): Promise<RepositoryData | null> {
    try {
      const repoInfo = await this.githubApiService.getRepositoryInfo(
        owner,
        repo,
      );

      const recentCommits = await this.getRecentCommits(owner, repo);
      const readmeContent = await this.getReadmeContent(owner, repo);
      const commitCount = await this.getCommitCount(owner, repo);

      let busFactorResult;
      try {
        busFactorResult = await this.busFactorService.calculateBusFactor(watchlistId);
      } catch (error) {
        this.logger.warn(`Failed to calculate bus factor for ${owner}/${repo}: ${error.message}`);
        busFactorResult = {
          busFactor: 0,
          totalContributors: 0,
          totalCommits: 0,
          topContributors: [],
          riskLevel: 'UNKNOWN',
          riskReason: 'Calculation failed',
          analysisDate: new Date(),
        };
      }

      const repoData: RepositoryData = {
        name: `${owner}/${repo}`,
        description: repoInfo.description,
        stars: repoInfo.stargazers_count,
        forks: repoInfo.forks_count,
        contributors: busFactorResult.totalContributors,
        language: undefined,
        topics: [],
        lastCommitDate: repoInfo.pushed_at
          ? new Date(repoInfo.pushed_at)
          : undefined,
        commitCount: commitCount,
        busFactor: busFactorResult.busFactor,
        riskScore: undefined,
        readmeContent: readmeContent,
        recentCommits: recentCommits,
      };

      return repoData;
    } catch (error) {
      this.logger.error(
        `Failed to collect repository data for ${owner}/${repo}:`,
        error,
      );
      return null;
    }
  }

  private async getRecentCommits(
    owner: string,
    repo: string,
  ): Promise<
    Array<{
      message: string;
      author: string;
      date: Date;
      filesChanged: number;
    }>
  > {
    try {
      const commits = await this.githubApiService.getLatestCommits(
        owner,
        repo,
        'main',
        5,
      );

      return commits.map((commit) => ({
        message: commit.commit.message,
        author: commit.commit.author.name,
        date: new Date(commit.commit.author.date),
        filesChanged: 0,
      }));
    } catch (error) {
      this.logger.warn(
        `Could not fetch recent commits for ${owner}/${repo}:`,
        error,
      );
      return [];
    }
  }

  private async getReadmeContent(
    owner: string,
    repo: string,
  ): Promise<string | undefined> {
    try {
      this.logger.log(
        `📝 README content fetching not yet implemented for ${owner}/${repo}`,
      );
      return undefined;
    } catch (error) {
      this.logger.warn(`Could not fetch README for ${owner}/${repo}:`, error);
      return undefined;
    }
  }

  private async getCommitCount(
    owner: string,
    repo: string,
  ): Promise<number | undefined> {
    try {
      const commits = await this.githubApiService.getLatestCommits(
        owner,
        repo,
        'main',
        100,
      );
      return commits.length;
    } catch (error) {
      this.logger.warn(
        `Could not get commit count for ${owner}/${repo}:`,
        error,
      );
      return undefined;
    }
  }


}
