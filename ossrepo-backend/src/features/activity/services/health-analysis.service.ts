import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ScorecardResult {
  repo: string;
  commit: string;
  scorecard: string;
  date: string;
  checks: {
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
  overallHealthScore: number; // 0-100
  analysisDate: Date;
}

@Injectable()
export class HealthAnalysisService {
  private readonly logger = new Logger(HealthAnalysisService.name);
  private readonly scorecardPath: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.scorecardPath = this.configService.get<string>('SCORECARD_PATH', 'scorecard');
  }

  async analyzeRepository(watchlistId: string, owner: string, repo: string, branch: string = 'main', commitShaOverride?: string): Promise<number> {
    const result = await this.performAnalysis(watchlistId, owner, repo, branch, commitShaOverride);
    return result.overallHealthScore;
  }

  /**
   * Run historical health analysis at multiple points in time
   */
  async runHistoricalHealthAnalysis(
    watchlistId: string, 
    owner: string, 
    repo: string, 
    commits: any[], 
    branch: string = 'main'
  ): Promise<{ current: number; historical: Array<{ date: Date; score: number; commitSha: string }> }> {
    
    if (commits.length === 0) {
      return { current: 0, historical: [] };
    }

    // Sort commits by date (oldest first)
    const sortedCommits = commits
      .map(commit => ({
        ...commit,
        date: new Date(commit.date)
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    // Determine number of health checks based on commit count
    const healthCheckCount = this.calculateHealthCheckCount(commits.length);
    
    // Calculate sampling points
    const samplingPoints = this.calculateSamplingPoints(sortedCommits, healthCheckCount);
    
    this.logger.log(`📊 Running ${healthCheckCount} historical health checks for ${owner}/${repo} (parallel)`);
    
    // Run health analysis at each sampling point in parallel
    const healthCheckPromises = samplingPoints.map(async (point, index) => {
      try {
        const score = await this.performAnalysis(watchlistId, owner, repo, branch, point.sha);
        this.logger.log(`   📈 ${point.date.toISOString().split('T')[0]}: ${score.overallHealthScore}/100`);
        return {
          date: point.date,
          score: score.overallHealthScore,
          commitSha: point.sha
        };
      } catch (error) {
        this.logger.warn(`⚠️ Failed to analyze health at ${point.date.toISOString().split('T')[0]}: ${error.message}`);
        return null;
      }
    });

    // Wait for all health checks to complete
    const historicalResults = (await Promise.all(healthCheckPromises))
      .filter(result => result !== null) as Array<{ date: Date; score: number; commitSha: string }>;

    // Get current health score (latest commit)
    const currentScore = await this.analyzeRepository(watchlistId, owner, repo, branch);
    
    return {
      current: currentScore,
      historical: historicalResults
    };
  }

  /**
   * Calculate how many health checks to run based on commit count
   */
  private calculateHealthCheckCount(commitCount: number): number {
    if (commitCount < 500) return 3;      // Every ~8 months
    if (commitCount < 1000) return 5;     // Every ~6 months  
    if (commitCount < 1500) return 6;     // Every ~4 months (reduced from 7)
    if (commitCount < 2000) return 8;     // Every ~3 months (reduced from 10)
    return 10;                            // Every ~2 months (reduced from 12)
  }

  /**
   * Calculate sampling points across the commit timeline
   */
  private calculateSamplingPoints(commits: any[], count: number): Array<{ sha: string; date: Date }> {
    if (commits.length === 0) return [];
    
    const points: Array<{ sha: string; date: Date }> = [];
    
    // Always include the oldest commit
    points.push({
      sha: commits[0].sha,
      date: commits[0].date
    });
    
    // Calculate intermediate points
    if (count > 2) {
      const step = (commits.length - 1) / (count - 1);
      for (let i = 1; i < count - 1; i++) {
        const index = Math.floor(i * step);
        points.push({
          sha: commits[index].sha,
          date: commits[index].date
        });
      }
    }
    
    // Always include the newest commit (if not already included)
    if (count > 1) {
      const lastCommit = commits[commits.length - 1];
      if (points[points.length - 1]?.sha !== lastCommit.sha) {
        points.push({
          sha: lastCommit.sha,
          date: lastCommit.date
        });
      }
    }
    
    return points;
  }

  private async performAnalysis(watchlistId: string, owner: string, repo: string, branch: string = 'main', commitShaOverride?: string): Promise<HealthAnalysisResult> {
    try {
      // Get the latest commit SHA from GitHub API, or use override
      const commitSha = commitShaOverride || await this.getLatestCommitSha(owner, repo, branch);

      // Get commit date (default to current date for now)
      let commitDate = new Date();

      // Run Scorecard analysis
      const scorecardResult = await this.runScorecard(owner, repo, commitSha);

      // Calculate overall health score from Scorecard results only
      const overallHealthScore = this.calculateScorecardHealthScore(scorecardResult);

      const result: HealthAnalysisResult = {
        watchlistId,
        commitSha,
        commitDate,
        scorecardMetrics: scorecardResult,
        overallHealthScore,
        analysisDate: new Date(),
      };

      // Store the results in the database
      await this.storeHealthResults(result);

      return result;

    } catch (error) {
      this.logger.error(`❌ Health analysis failed for ${owner}/${repo}: ${error.message}`);
      throw error;
    }
  }

  private async getLatestCommitSha(owner: string, repo: string, branch: string): Promise<string> {
    try {
      const response = await fetch(
        `${process.env.GITHUB_API_BASE_URL}/repos/${owner}/${repo}/commits/${branch}`,
        {
          headers: {
            'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
            'Accept': 'application/vnd.github.v3+json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.statusText}`);
      }

      const commitData = await response.json();
      return commitData.sha;
    } catch (error) {
      this.logger.error(`Error getting latest commit SHA for ${owner}/${repo}:`, error);
      throw error;
    }
  }

  private async runScorecard(owner: string, repo: string, commitSha: string): Promise<ScorecardResult | null> {
    try {
      let stdout: string;
      let stderr: string;

      try {
        const result = await execAsync(
          `${this.scorecardPath} --repo=github.com/${owner}/${repo} --commit=${commitSha} --format=json`,
          { 
            timeout: 300000, // 5 minute timeout
            env: {
              ...process.env,
              GITHUB_AUTH_TOKEN: process.env.GITHUB_TOKEN || process.env.GITHUB_AUTH_TOKEN,
            }
          }
        );
        stdout = result.stdout;
        stderr = result.stderr;
      } catch (execError: any) {
        // Scorecard might exit with error code but still return valid JSON
        if (execError.stdout) {
          stdout = execError.stdout;
          stderr = execError.stderr || '';
        } else {
          // No stdout, this is a real failure
          this.logger.error(`❌ Scorecard failed for ${owner}/${repo}: ${execError.message}`);
          return null;
        }
      }

      // Parse the JSON output even if there are stderr warnings
      let scorecardData;
      try {
        scorecardData = JSON.parse(stdout);
      } catch (parseError) {
        this.logger.error(`❌ Failed to parse Scorecard JSON for ${owner}/${repo}`);
        return null;
      }

      // Check if we have valid data
      if (!scorecardData || !scorecardData.checks) {
        this.logger.error(`❌ Invalid Scorecard data for ${owner}/${repo}`);
        return null;
      }

      return {
        repo: `${owner}/${repo}`,
        commit: commitSha,
        scorecard: scorecardData.scorecard.version,
        date: scorecardData.date,
        checks: scorecardData.checks,
      };

    } catch (error) {
      this.logger.error(`❌ Scorecard error for ${owner}/${repo}: ${error.message}`);
      return null;
    }
  }

  private calculateScorecardHealthScore(scorecard: ScorecardResult | null): number {
    if (!scorecard || !scorecard.checks) {
      return 0;
    }

    // Filter out checks with -1 scores (errors/failures) and only use valid scores
    const validChecks = Object.values(scorecard.checks).filter(check => check.score >= 0);
    
    if (validChecks.length === 0) {
      return 0;
    }

    // Calculate average score from valid checks only
    const totalScore = validChecks.reduce((sum, check) => sum + check.score, 0);
    const averageScore = totalScore / validChecks.length;
    
    // Scorecard scores are typically 0-10, convert to 0-100
    const finalScore = Math.round(averageScore * 10);
    
    return finalScore;
  }

  private async storeHealthResults(result: HealthAnalysisResult): Promise<void> {
    try {
      // For now, we'll just log the results
      // TODO: Implement proper storage when we have the health analysis table schema
    } catch (error) {
      this.logger.error(`❌ Failed to store health results: ${error.message}`);
      throw error;
    }
  }
} 