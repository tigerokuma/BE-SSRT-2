import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConnectionService } from '../../../common/azure/azure.service';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly azureService: ConnectionService,
  ) {}

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
   * Run scorecard on a repository (local or remote based on SCORECARD_LOCATION env)
   */
  async runScorecardRemotely(
    repoPath: string,
    commitSha?: string,
    owner?: string,
    repo?: string
  ): Promise<ScorecardResult | null> {
    try {
      // Check SCORECARD_LOCATION environment variable
      const scorecardLocation = process.env.SCORECARD_LOCATION?.toLowerCase() || 'remote';
      
      const useLocal = scorecardLocation === 'local';
      let stdout: string;
      let stderr: string;

      if (useLocal) {
        // Execute local command using the script
        const scriptPath = path.join(process.cwd(), 'scripts', 'run_scorecard.sh');
        
        // Build command with proper escaping
        let command: string;
        if (commitSha && owner && repo) {
          command = `bash "${scriptPath}" "${repoPath}" "${commitSha}" "${owner}" "${repo}"`;
          this.logger.log(`🔍 Running Scorecard locally on repository ${repoPath}@${commitSha.substring(0, 8)}`);
        } else if (commitSha) {
          command = `bash "${scriptPath}" "${repoPath}" "${commitSha}"`;
          this.logger.log(`🔍 Running Scorecard locally on repository ${repoPath}@${commitSha.substring(0, 8)}`);
        } else if (owner && repo) {
          command = `bash "${scriptPath}" "${repoPath}" "" "${owner}" "${repo}"`;
          this.logger.log(`🔍 Running Scorecard locally on repository ${repoPath}`);
        } else {
          command = `bash "${scriptPath}" "${repoPath}"`;
          this.logger.log(`🔍 Running Scorecard locally on repository ${repoPath}`);
        }

        try {
          const result = await execAsync(command, {
            cwd: process.cwd(),
            maxBuffer: 10 * 1024 * 1024, // 10MB buffer
          });
          stdout = result.stdout;
          stderr = result.stderr;
        } catch (execError: any) {
          this.logger.error(`❌ Scorecard failed for ${repoPath}: ${execError.message}`);
          return null;
        }
      } else {
        // Execute remote command using the script
        const scriptPath = './scripts/run_scorecard.sh';
        
        // Build command with proper escaping
        let command: string;
        if (commitSha && owner && repo) {
          command = `bash ${scriptPath} "${repoPath}" "${commitSha}" "${owner}" "${repo}"`;
          this.logger.log(`🔍 Running Scorecard remotely on repository ${repoPath}@${commitSha.substring(0, 8)}`);
        } else if (commitSha) {
          command = `bash ${scriptPath} "${repoPath}" "${commitSha}"`;
          this.logger.log(`🔍 Running Scorecard remotely on repository ${repoPath}@${commitSha.substring(0, 8)}`);
        } else if (owner && repo) {
          command = `bash ${scriptPath} "${repoPath}" "" "${owner}" "${repo}"`;
          this.logger.log(`🔍 Running Scorecard remotely on repository ${repoPath}`);
        } else {
          command = `bash ${scriptPath} "${repoPath}"`;
          this.logger.log(`🔍 Running Scorecard remotely on repository ${repoPath}`);
        }

        try {
          const result = await this.azureService.executeRemoteCommand(command);
          stdout = result.stdout;
          stderr = result.stderr;
          
          if (result.code !== 0) {
            this.logger.warn(`⚠️ Scorecard command exited with code ${result.code}`);
            if (stderr) {
              this.logger.warn(`⚠️ stderr: ${stderr}`);
            }
            return null;
          }
        } catch (execError: any) {
          this.logger.error(`❌ Scorecard failed for ${repoPath}: ${execError.message}`);
          return null;
        }
      }

      let scorecardData;
      try {
        scorecardData = JSON.parse(stdout);
      } catch (parseError) {
        this.logger.error(`❌ Failed to parse Scorecard JSON for ${repoPath}`);
        if (stderr) {
          this.logger.error(`❌ stderr: ${stderr}`);
        }
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
      this.logger.error(`❌ Failed to run scorecard:`, error);
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
          'api',
          latestCommit.timestamp
        );
        this.logger.log(`✅ Stored API scorecard for commit ${latestCommit.sha}`);
      }

      // Skip historical analysis if SKIP_HISTORICAL_SCORECARD is set (saves time, avoids rate limits)
      const skipHistorical = process.env.SKIP_HISTORICAL_SCORECARD === 'true';
      if (skipHistorical) {
        this.logger.log(`⏭️ Skipping historical scorecard analysis (SKIP_HISTORICAL_SCORECARD=true)`);
        return;
      }

      // Skip historical analysis for very large repos (next.js, react, etc.) - API result is enough
      const largeRepos = ['next.js', 'react', 'vue', 'angular', 'typescript', 'node', 'vscode'];
      if (largeRepos.includes(repo.toLowerCase())) {
        this.logger.log(`⏭️ Skipping historical scorecard for large repo ${owner}/${repo} - using API result only`);
        return;
      }

      // Sample commits evenly throughout history for health trend analysis
      const commitsToProcess = this.sampleCommitsEvenly(commits, 5); // Reduced from 10 to 5
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

        const localResult = await this.runScorecardRemotely(repoPath, commit.sha, owner, repo);
        
        if (localResult) {
          await this.storeScorecard(
            packageId,
            commit.sha,
            localResult.score,
            localResult.data,
            'local',
            commit.timestamp
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
    source: 'api' | 'local',
    commitDate?: Date
  ): Promise<void> {
    try {
      // Get commit date from database if not provided
      let actualCommitDate = commitDate;
      if (!actualCommitDate) {
        const commit = await this.prisma.packageCommit.findFirst({
          where: {
            package_id: packageId,
            sha: commitSha
          }
        });
        actualCommitDate = commit?.timestamp || new Date();
      }

      await this.prisma.packageScorecardHistory.create({
        data: {
          package_id: packageId,
          commit_sha: commitSha,
          commit_date: actualCommitDate,
          score,
          scorecard_data: data,
          source,
        }
      });

      this.logger.log(`💾 Stored scorecard data for package ${packageId}, commit ${commitSha.substring(0, 8)} (${actualCommitDate.toISOString()})`);
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
