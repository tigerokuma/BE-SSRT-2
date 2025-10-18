import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ScorecardResult {
  score: number;
  data: any;
  source: 'api' | 'local';
  commitSha?: string;
}

@Injectable()
export class PackageScorecardService {
  private readonly logger = new Logger(PackageScorecardService.name);
  private readonly scorecardPath = 'scorecard'; // Assuming scorecard is in PATH

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Check Scorecard API for existing scores
   */
  async checkScorecardAPI(owner: string, repo: string): Promise<ScorecardResult | null> {
    try {
      const scorecardUrl = `https://api.securityscorecards.dev/projects/github.com/${owner}/${repo}`;
      this.logger.log(`🔍 Checking Scorecard API: ${scorecardUrl}`);
      
      const response = await fetch(scorecardUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'OSS-Repository-Backend'
        }
      });

      if (response.ok) {
        const data = await response.json();
        const score = data.score || 0;
        this.logger.log(`✅ Scorecard API found score: ${score}`);
        return {
          score,
          data,
          source: 'api'
        };
      } else {
        this.logger.log(`⚠️ Scorecard API returned ${response.status}: ${response.statusText}`);
        return null;
      }
    } catch (error) {
      this.logger.log(`❌ Scorecard API error: ${error.message}`);
      return null;
    }
  }

  /**
   * Run scorecard locally on a repository
   */
  async runScorecardLocally(
    repoPath: string,
    commitSha?: string
  ): Promise<ScorecardResult | null> {
    try {
      let command: string;

      if (commitSha) {
        command = `${this.scorecardPath} --local=${repoPath} --commit=${commitSha} --format=json --show-details`;
        this.logger.log(`🔍 Running Scorecard on local repository ${repoPath}@${commitSha.substring(0, 8)}`);
      } else {
        command = `${this.scorecardPath} --local=${repoPath} --format=json --show-details`;
        this.logger.log(`🔍 Running Scorecard on local repository ${repoPath}`);
      }

      let stdout: string;
      let stderr: string;

      try {
        const result = await execAsync(command, {
          timeout: 400000, // 6+ minutes timeout for scorecard
        });
        stdout = result.stdout;
        stderr = result.stderr;
      } catch (execError: any) {
        if (execError.stdout) {
          stdout = execError.stdout;
          stderr = execError.stderr || '';
        } else {
          this.logger.error(`❌ Scorecard failed for ${repoPath}: ${execError.message}`);
          return null;
        }
      }

      let scorecardData;
      try {
        scorecardData = JSON.parse(stdout);
      } catch (parseError) {
        this.logger.error(`❌ Failed to parse Scorecard JSON for ${repoPath}`);
        return null;
      }

      if (!scorecardData || !scorecardData.checks) {
        this.logger.error(`❌ Invalid Scorecard data for ${repoPath}`);
        return null;
      }

      const overallScore = scorecardData.score || 0;

      return {
        score: overallScore,
        data: scorecardData,
        source: 'local',
        commitSha
      };
    } catch (error) {
      this.logger.error(`❌ Failed to run local scorecard:`, error);
      return null;
    }
  }

  /**
   * Process historical scores for multiple commits
   */
  async processHistoricalScores(
    packageId: string,
    commits: Array<{ sha: string; timestamp: Date }>,
    repoPath: string,
    owner: string,
    repo: string
  ): Promise<void> {
    try {
      this.logger.log(`📊 Processing historical scores for ${commits.length} commits`);

      // First try API for the latest commit
      const latestCommit = commits[0];
      let apiResult = await this.checkScorecardAPI(owner, repo);
      
      if (apiResult) {
        // Store API result for latest commit
        await this.storeScorecard(
          packageId,
          latestCommit.sha,
          apiResult.score,
          apiResult.data,
          'api'
        );
        this.logger.log(`✅ Stored API scorecard for commit ${latestCommit.sha}`);
      }

      // Sample commits evenly throughout history for health trend analysis
      const commitsToProcess = this.sampleCommitsEvenly(commits, 10);
      this.logger.log(`📈 Selected ${commitsToProcess.length} commits for historical analysis: ${commitsToProcess.map(c => c.sha.substring(0, 8)).join(', ')}`);
      
      for (const commit of commitsToProcess) {
        // Skip if we already have data for this commit
        const existing = await this.prisma.packageScorecardHistory.findFirst({
          where: {
            package_id: packageId,
            commit_sha: commit.sha
          }
        });

        if (existing) {
          this.logger.log(`⏭️ Skipping commit ${commit.sha} - already processed`);
          continue;
        }

        const localResult = await this.runScorecardLocally(repoPath, commit.sha);
        
        if (localResult) {
          await this.storeScorecard(
            packageId,
            commit.sha,
            localResult.score,
            localResult.data,
            'local'
          );
          this.logger.log(`✅ Stored local scorecard for commit ${commit.sha} (${commit.timestamp.toISOString().split('T')[0]})`);
        } else {
          this.logger.warn(`⚠️ Failed to get scorecard for commit ${commit.sha}`);
        }

        // Add small delay to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

    } catch (error) {
      this.logger.error(`❌ Failed to process historical scores:`, error);
      throw error;
    }
  }

  /**
   * Sample commits evenly throughout the repository history
   */
  private sampleCommitsEvenly(
    commits: Array<{ sha: string; timestamp: Date }>, 
    sampleSize: number
  ): Array<{ sha: string; timestamp: Date }> {
    if (commits.length <= sampleSize) {
      return commits;
    }

    // Sort commits by timestamp (oldest first)
    const sortedCommits = [...commits].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    
    const sampled: Array<{ sha: string; timestamp: Date }> = [];
    const step = Math.floor(sortedCommits.length / (sampleSize - 1));
    
    // Always include the oldest commit
    sampled.push(sortedCommits[0]);
    
    // Sample evenly throughout history
    for (let i = 1; i < sampleSize - 1; i++) {
      const index = i * step;
      if (index < sortedCommits.length) {
        sampled.push(sortedCommits[index]);
      }
    }
    
    // Always include the latest commit
    if (sortedCommits.length > 1) {
      sampled.push(sortedCommits[sortedCommits.length - 1]);
    }
    
    // Sort by timestamp (newest first) for consistency
    return sampled.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Store scorecard data in database
   */
  async storeScorecard(
    packageId: string,
    commitSha: string,
    score: number,
    data: any,
    source: 'api' | 'local'
  ): Promise<void> {
    try {
      await this.prisma.packageScorecardHistory.create({
        data: {
          package_id: packageId,
          commit_sha: commitSha,
          score,
          scorecard_data: data,
          source,
        }
      });

      this.logger.log(`💾 Stored scorecard data for package ${packageId}, commit ${commitSha.substring(0, 8)}`);
    } catch (error) {
      this.logger.error(`❌ Failed to store scorecard data:`, error);
      throw error;
    }
  }

  /**
   * Get latest scorecard score for a package
   */
  async getLatestScore(packageId: string): Promise<number | null> {
    try {
      const latest = await this.prisma.packageScorecardHistory.findFirst({
        where: { package_id: packageId },
        orderBy: { analyzed_at: 'desc' }
      });

      return latest?.score || null;
    } catch (error) {
      this.logger.error(`❌ Failed to get latest score:`, error);
      return null;
    }
  }

  /**
   * Get scorecard history for a package
   */
  async getScorecardHistory(packageId: string, limit: number = 50): Promise<any[]> {
    try {
      return await this.prisma.packageScorecardHistory.findMany({
        where: { package_id: packageId },
        orderBy: { analyzed_at: 'desc' },
        take: limit
      });
    } catch (error) {
      this.logger.error(`❌ Failed to get scorecard history:`, error);
      return [];
    }
  }
}
