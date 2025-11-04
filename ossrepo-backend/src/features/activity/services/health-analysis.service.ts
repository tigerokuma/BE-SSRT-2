import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConnectionService } from '../../../common/azure/azure.service';

export interface ScorecardResult {
  repo: string;
  commit: string;
  scorecard: string;
  date: string;
  score: number;
  checks:
    | Array<{
        name: string;
        score: number;
        reason: string;
        details: string[] | null;
      }>
    | {
        [key: string]: {
          name: string;
          score: number;
          reason: string;
          details: string[];
        };
      };
}

export interface HealthAnalysisResult {
  watchlistId: string;
  commitSha: string;
  commitDate: Date;
  scorecardMetrics: ScorecardResult | null;
  overallHealthScore: number;
  analysisDate: Date;
}

@Injectable()
export class HealthAnalysisService {
  private readonly logger = new Logger(HealthAnalysisService.name);
  private readonly scorecardPath: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly azureService: ConnectionService,
  ) {
    this.scorecardPath = this.configService.get<string>(
      'SCORECARD_PATH',
      'scorecard',
    );
    this.logger.log(`🔧 Scorecard CLI path: ${this.scorecardPath}`);
  }

  async analyzeRepository(
    watchlistId: string,
    owner: string,
    repo: string,
    branch: string = 'main',
    commitShaOverride?: string,
    repoPath?: string,
  ): Promise<number> {
    this.logger.log(
      `🔄 Using local Scorecard CLI analysis for ${owner}/${repo}`,
    );
    const result = await this.performAnalysis(
      watchlistId,
      owner,
      repo,
      branch,
      commitShaOverride,
      undefined,
      repoPath,
    );
    return result.overallHealthScore;
  }

  async runHistoricalHealthAnalysis(
    watchlistId: string,
    owner: string,
    repo: string,
    commits: any[],
    branch: string = 'main',
    repoPath?: string,
  ): Promise<{
    current: number;
    historical: Array<{
      date: Date;
      score: number;
      commitSha: string | null;
      scorecardMetrics?: any;
    }>;
  }> {
    if (commits.length === 0) {
      return { current: 0, historical: [] };
    }

    this.logger.log(
      `🔄 Using local Scorecard CLI analysis for ${owner}/${repo}`,
    );
    return this.runLocalHistoricalAnalysis(
      watchlistId,
      owner,
      repo,
      commits,
      branch,
      repoPath,
    );
  }

  async runLocalHistoricalAnalysis(
    watchlistId: string,
    owner: string,
    repo: string,
    commits: any[],
    branch: string = 'main',
    repoPath?: string,
  ): Promise<{
    current: number;
    historical: Array<{
      date: Date;
      score: number;
      commitSha: string | null;
      scorecardMetrics?: any;
    }>;
  }> {
    const sortedCommits = commits
      .map((commit) => ({
        ...commit,
        date: new Date(commit.date),
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    const healthCheckCount = this.calculateHealthCheckCount(commits.length);
    const samplingPoints = this.calculateSamplingPoints(
      sortedCommits,
      healthCheckCount,
    );

    this.logger.log(
      `📊 Running ${healthCheckCount} local historical health checks for ${owner}/${repo} (parallel)`,
    );
    this.logger.log(
      `📊 Scorecard test count: ${healthCheckCount} (commits: ${commits.length}, <1000: 3 tests, <2000: 4 tests, >=2000: 4 tests)`,
    );

    const healthCheckPromises = samplingPoints.map(async (point) => {
      try {
        const result = await this.performAnalysis(
          watchlistId,
          owner,
          repo,
          branch,
          point.sha,
          point.date, // Pass the actual commit date
          repoPath,
        );
        this.logger.log(
          `   📈 ${point.date.toISOString().split('T')[0]}: ${result.overallHealthScore.toFixed(1)}/10`,
        );
        return {
          date: point.date,
          score: result.overallHealthScore,
          commitSha: point.sha,
          scorecardMetrics: result.scorecardMetrics,
        };
      } catch (error) {
        this.logger.warn(
          `⚠️ Failed to analyze health at ${point.date.toISOString().split('T')[0]}: ${error.message}`,
        );
        return {
          date: point.date,
          score: 50,
          commitSha: point.sha,
          scorecardMetrics: null,
        };
      }
    });

    const historicalResults = (await Promise.all(
      healthCheckPromises,
    )) as Array<{
      date: Date;
      score: number;
      commitSha: string | null;
      scorecardMetrics?: any;
    }>;

    const currentScore =
      historicalResults.length > 0
        ? historicalResults[historicalResults.length - 1].score
        : 0;

    return {
      current: currentScore,
      historical: historicalResults,
    };
  }

  private calculateHealthCheckCount(commitCount: number): number {
    // Ensure we only run a maximum of 4 scorecard tests
    if (commitCount < 1000) return 3;
    if (commitCount < 2000) return 4;
    return 4; // Maximum of 4 tests for any repository
  }

  private calculateSamplingPoints(
    commits: any[],
    count: number,
  ): Array<{ sha: string; date: Date }> {
    if (commits.length === 0) return [];

    const points: Array<{ sha: string; date: Date }> = [];

    this.logger.log(
      `🔍 Calculating sampling points: ${count} tests for ${commits.length} commits`,
    );

    points.push({
      sha: commits[0].sha,
      date: commits[0].date,
    });
    this.logger.log(
      `   📍 Added first commit: ${commits[0].sha.substring(0, 8)}`,
    );

    if (count > 2) {
      const step = (commits.length - 1) / (count - 1);
      this.logger.log(
        `   📍 Adding ${count - 2} intermediate points with step ${step.toFixed(2)}`,
      );
      for (let i = 1; i < count - 1; i++) {
        const index = Math.floor(i * step);
        points.push({
          sha: commits[index].sha,
          date: commits[index].date,
        });
        this.logger.log(
          `   📍 Added intermediate commit ${i}: ${commits[index].sha.substring(0, 8)} (index ${index})`,
        );
      }
    }

    if (count > 1) {
      const lastCommit = commits[commits.length - 1];
      if (points[points.length - 1]?.sha !== lastCommit.sha) {
        points.push({
          sha: lastCommit.sha,
          date: lastCommit.date,
        });
        this.logger.log(
          `   📍 Added last commit: ${lastCommit.sha.substring(0, 8)}`,
        );
      } else {
        this.logger.log(`   📍 Last commit already included, skipping`);
      }
    }

    this.logger.log(`   📍 Total sampling points: ${points.length}`);
    return points;
  }

  private async performAnalysis(
    watchlistId: string,
    owner: string,
    repo: string,
    branch: string = 'main',
    commitShaOverride?: string,
    commitDate?: Date,
    repoPath?: string,
  ): Promise<HealthAnalysisResult> {
    try {
      const commitSha =
        commitShaOverride ||
        (await this.getLatestCommitSha(owner, repo, branch));

      const dateToUse = commitDate || new Date();
      const scorecardResult = await this.runScorecard(
        owner,
        repo,
        commitSha,
        repoPath,
      );
      const overallHealthScore =
        this.calculateScorecardHealthScore(scorecardResult);

      const result: HealthAnalysisResult = {
        watchlistId,
        commitSha,
        commitDate: dateToUse,
        scorecardMetrics: scorecardResult,
        overallHealthScore,
        analysisDate: new Date(),
      };

      await this.storeHealthResults(result);

      return result;
    } catch (error) {
      this.logger.error(
        `❌ Health analysis failed for ${owner}/${repo}: ${error.message}`,
      );
      throw error;
    }
  }

  private async getLatestCommitSha(
    owner: string,
    repo: string,
    branch: string,
  ): Promise<string> {
    try {
      const baseUrl = this.configService.get<string>(
        'GITHUB_API_BASE_URL',
        'https://api.github.com',
      );
      const token = this.configService.get<string>('GITHUB_TOKEN');

      const response = await fetch(
        `${baseUrl}/repos/${owner}/${repo}/commits/${branch}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github.v3+json',
          },
        },
      );

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.statusText}`);
      }

      const commitData = (await response.json()) as { sha: string };
      return commitData.sha;
    } catch (error) {
      this.logger.error(
        `Error getting latest commit SHA for ${owner}/${repo}:`,
        error,
      );
      throw error;
    }
  }

  private async runScorecard(
    owner: string,
    repo: string,
    commitSha: string,
    repoPath?: string,
  ): Promise<ScorecardResult | null> {
    try {
      let command: string;

      if (repoPath) {
        // Use local repository path
        command = `docker run --rm gcr.io/openssf/scorecard:stable --local=${repoPath} --commit=${commitSha} --format=json --show-details`;
        this.logger.log(
          `🔍 Running Scorecard on local repository ${repoPath}@${commitSha.substring(0, 8)}`,
        );
      } else {
        // Fallback to GitHub URL
        command = `docker run --rm gcr.io/openssf/scorecard:stable --repo=github.com/${owner}/${repo} --commit=${commitSha} --format=json --show-details`;
        this.logger.log(
          `🔍 Running Scorecard on ${owner}/${repo}@${commitSha.substring(0, 8)}`,
        );
      }

      let stdout: string;
      let stderr: string;

      try {
        const result = await this.azureService.executeRemoteCommand(command);
        stdout = result.stdout;
        stderr = result.stderr;
      } catch (execError: any) {
        if (execError.stdout) {
          stdout = execError.stdout;
          stderr = execError.stderr || '';
        } else {
          this.logger.error(
            `❌ Scorecard failed for ${owner}/${repo}: ${execError.message}`,
          );
          return null;
        }
      }

      let scorecardData;
      try {
        scorecardData = JSON.parse(stdout);
      } catch (parseError) {
        this.logger.error(
          `❌ Failed to parse Scorecard JSON for ${owner}/${repo}`,
        );
        return null;
      }

      if (!scorecardData || !scorecardData.checks) {
        this.logger.error(`❌ Invalid Scorecard data for ${owner}/${repo}`);
        return null;
      }

      const overallScore = scorecardData.score || 0;

      return {
        repo: `${owner}/${repo}`,
        commit: commitSha,
        scorecard: scorecardData.scorecard.version,
        date: scorecardData.date,
        score: overallScore,
        checks: scorecardData.checks,
      };
    } catch (error) {
      this.logger.error(
        `❌ Scorecard error for ${owner}/${repo}: ${error.message}`,
      );
      return null;
    }
  }

  private calculateScorecardHealthScore(
    scorecard: ScorecardResult | null,
  ): number {
    if (!scorecard || !scorecard.checks) {
      return 0;
    }

    if (scorecard.score && scorecard.score > 0) {
      return scorecard.score;
    }

    let checksArray: any[];
    if (Array.isArray(scorecard.checks)) {
      checksArray = scorecard.checks;
    } else {
      checksArray = Object.values(scorecard.checks);
    }

    const validChecks = checksArray.filter((check) => check.score >= 0);

    if (validChecks.length === 0) {
      return 0;
    }

    const totalScore = validChecks.reduce((sum, check) => sum + check.score, 0);
    const averageScore = totalScore / validChecks.length;

    return averageScore;
  }

  private async storeHealthResults(
    result: HealthAnalysisResult,
  ): Promise<void> {
    try {
      await this.prisma.healthData.create({
        data: {
          watchlist_id: result.watchlistId,
          commit_sha: result.commitSha,
          commit_date: result.commitDate,
          scorecard_metrics: (result.scorecardMetrics as any) || undefined,
          overall_health_score: result.overallHealthScore,
          analysis_date: result.analysisDate,
          source: 'scorecard',
        },
      });

      this.logger.log(
        `✅ Health results stored for watchlist ${result.watchlistId} - Score: ${result.overallHealthScore}`,
      );
    } catch (error) {
      this.logger.error(`❌ Failed to store health results: ${error.message}`);
      throw error;
    }
  }
}
