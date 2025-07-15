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

  async analyzeRepository(watchlistId: string, owner: string, repo: string, branch: string = 'main', commitShaOverride?: string): Promise<HealthAnalysisResult> {
    return this.performAnalysis(watchlistId, owner, repo, branch, commitShaOverride);
  }

  private async performAnalysis(watchlistId: string, owner: string, repo: string, branch: string = 'main', commitShaOverride?: string): Promise<HealthAnalysisResult> {
    try {
      this.logger.log(`Starting health analysis for ${owner}/${repo}`);

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

      this.logger.log(`Completed health analysis for ${owner}/${repo}. Overall score: ${overallHealthScore}/100`);

      return result;

    } catch (error) {
      this.logger.error(`Error analyzing repository ${owner}/${repo}:`, error);
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
      this.logger.log(`Running Scorecard analysis for ${owner}/${repo}`);

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
          this.logger.warn(`Scorecard exited with error code ${execError.code} for ${owner}/${repo}, but returned JSON output`);
        } else {
          // No stdout, this is a real failure
          this.logger.error(`Scorecard failed completely for ${owner}/${repo}:`, execError);
          return null;
        }
      }

      // Parse the JSON output even if there are stderr warnings
      let scorecardData;
      try {
        scorecardData = JSON.parse(stdout);
      } catch (parseError) {
        this.logger.error(`Error parsing Scorecard JSON for ${owner}/${repo}:`, parseError);
        return null;
      }

      // Log stderr warnings but don't fail the process
      if (stderr) {
        this.logger.warn(`Scorecard stderr for ${owner}/${repo}: ${stderr}`);
      }

      // Check if we have valid data
      if (!scorecardData || !scorecardData.checks) {
        this.logger.error(`Invalid Scorecard data for ${owner}/${repo}`);
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
      this.logger.error(`Error running Scorecard for ${owner}/${repo}:`, error);
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
      this.logger.warn(`No valid checks found for scorecard analysis`);
      return 0;
    }

    // Calculate average score from valid checks only
    const totalScore = validChecks.reduce((sum, check) => sum + check.score, 0);
    const averageScore = totalScore / validChecks.length;
    
    // Scorecard scores are typically 0-10, convert to 0-100
    const finalScore = Math.round(averageScore * 10);
    
    this.logger.log(`Calculated health score: ${finalScore}/100 from ${validChecks.length} valid checks (${Object.values(scorecard.checks).length} total checks)`);
    
    return finalScore;
  }

  private async storeHealthResults(result: HealthAnalysisResult): Promise<void> {
    try {
      // For now, we'll just log the results
      // TODO: Implement proper storage when we have the health analysis table schema
      this.logger.log(`Health analysis results for ${result.watchlistId}:`, {
        commitSha: result.commitSha,
        overallHealthScore: result.overallHealthScore,
        analysisDate: result.analysisDate,
      });
    } catch (error) {
      this.logger.error('Error storing health results:', error);
      throw error;
    }
  }
} 