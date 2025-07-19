import { Injectable, Logger } from '@nestjs/common';
import { BigQuery } from '@google-cloud/bigquery';

export interface ScorecardData {
  repo: string;
  date: string;
  score: number;
  checks: Array<{
    name: string;
    score: number;
    reason: string;
  }>;
  metadata: {
    repo_metadata: {
      name: string;
      description: string;
      stars: number;
      license: string;
      default_branch: string;
    };
  };
}

export interface HistoricalScorecardData {
  date: Date;
  score: number;
  checks: Array<{
    name: string;
    score: number;
    reason: string;
  }>;
}

@Injectable()
export class ScorecardService {
  private readonly logger = new Logger(ScorecardService.name);
  private readonly bigquery = new BigQuery();

  /**
   * Get historical Scorecard data for a repository within a date range
   * This is used to match with commit timelines instead of running local health checks
   */
  async getHistoricalScorecardData(
    owner: string, 
    repo: string, 
    startDate: Date, 
    endDate: Date
  ): Promise<HistoricalScorecardData[]> {
    try {
      const repoUrl = `github.com/${owner}/${repo}`;
      // No logging to reduce noise

      const query = `
        SELECT 
          date,
          score,
          checks
        FROM \`openssf.scorecardcron.scorecard-v2\`
        WHERE repo.name = @repo
        AND date >= @startDate
        AND date <= @endDate
        ORDER BY date ASC`;

      const options = {
        query,
        params: { 
          repo: repoUrl,
          startDate: startDate.toISOString().split('T')[0], // Format as YYYY-MM-DD
          endDate: endDate.toISOString().split('T')[0]
        },
        location: 'US',
      };

      const [job] = await this.bigquery.createQueryJob(options);
      const [rows] = await job.getQueryResults();

      const historicalData: HistoricalScorecardData[] = rows.map(row => {
        // Debug: Log the raw date value from BigQuery
        this.logger.log(`🔍 Debug: BigQuery row.date = "${row.date}" (type: ${typeof row.date})`);
        
        let parsedDate: Date;
        try {
          parsedDate = new Date(row.date);
          if (isNaN(parsedDate.getTime())) {
            this.logger.warn(`⚠️ Invalid date from BigQuery: "${row.date}", using current date`);
            parsedDate = new Date();
          } else {
            this.logger.log(`✅ Successfully parsed BigQuery date: ${parsedDate.toISOString()}`);
          }
        } catch (error) {
          this.logger.warn(`⚠️ Error parsing BigQuery date: "${row.date}", using current date`);
          parsedDate = new Date();
        }
        
        return {
          date: parsedDate,
          score: row.score,
          checks: row.checks || []
        };
      });

      // No logging to reduce noise
      return historicalData;
    } catch (error) {
      this.logger.error(`❌ Error fetching historical Scorecard data for ${owner}/${repo}:`, error.message);
      return [];
    }
  }

  /**
   * Get the latest Scorecard data for a repository
   */
  async getLatestScorecard(owner: string, repo: string): Promise<ScorecardData | null> {
    try {
      const repoUrl = `github.com/${owner}/${repo}`;
      this.logger.log(`🔍 Querying Scorecard data for ${repoUrl}`);

      const query = `
        SELECT 
          repo,
          date,
          score,
          checks,
          metadata
        FROM \`openssf.scorecardcron.scorecard-v2\`
        WHERE repo.name = @repo
        ORDER BY date DESC
        LIMIT 1`;

      const options = {
        query,
        params: { repo: repoUrl },
        location: 'US',
      };

      const [job] = await this.bigquery.createQueryJob(options);
      const [rows] = await job.getQueryResults();

      if (rows.length === 0) {
        this.logger.log(`❌ No Scorecard data found for ${repoUrl}`);
        return null;
      }

      const scorecardData = rows[0] as ScorecardData;
      this.logger.log(`✅ Found Scorecard data for ${repoUrl} - Score: ${scorecardData.score}`);

      return scorecardData;
    } catch (error) {
      this.logger.error(`❌ Error fetching Scorecard data for ${owner}/${repo}:`, error.message);
      
      // Don't throw error - just return null so we can fall back to local analysis
      return null;
    }
  }

  /**
   * Get Scorecard data for multiple repositories
   */
  async getScorecardForMultipleRepos(repos: Array<{ owner: string; repo: string }>): Promise<Map<string, ScorecardData>> {
    try {
      const repoUrls = repos.map(({ owner, repo }) => `github.com/${owner}/${repo}`);
      this.logger.log(`🔍 Querying Scorecard data for ${repoUrls.length} repositories`);

      const query = `
        SELECT 
          repo,
          date,
          score,
          checks,
          metadata
        FROM \`openssf.scorecardcron.scorecard-v2\`
        WHERE repo.name IN (${repoUrls.map(() => `?`).join(',')})
        AND date = (
          SELECT MAX(date) 
          FROM \`openssf.scorecardcron.scorecard-v2\` 
          WHERE repo.name IN (${repoUrls.map(() => `?`).join(',')})
        )
      `;

      const options = {
        query,
        params: [...repoUrls, ...repoUrls], // Duplicate for the subquery
        location: 'US',
      };

      const [job] = await this.bigquery.createQueryJob(options);
      const [rows] = await job.getQueryResults();

      const result = new Map<string, ScorecardData>();
      for (const row of rows) {
        const scorecardData = row as ScorecardData;
        result.set(scorecardData.repo, scorecardData);
      }

      this.logger.log(`✅ Found Scorecard data for ${result.size}/${repoUrls.length} repositories`);
      return result;
    } catch (error) {
      this.logger.error(`❌ Error fetching Scorecard data for multiple repos:`, error.message);
      return new Map();
    }
  }

  /**
   * Check if Scorecard data exists for a repository
   */
  async hasScorecardData(owner: string, repo: string): Promise<boolean> {
    try {
      const repoUrl = `github.com/${owner}/${repo}`;
      
      const query = `
        SELECT COUNT(*) as count
        FROM \`openssf.scorecardcron.scorecard-v2\`
        WHERE repo.name = @repo
      `;

      const options = {
        query,
        params: { repo: repoUrl },
        location: 'US',
      };

      const [job] = await this.bigquery.createQueryJob(options);
      const [rows] = await job.getQueryResults();

      const hasData = rows[0]?.count > 0;
      this.logger.log(`🔍 Scorecard data exists for ${repoUrl}: ${hasData}`);
      
      return hasData;
    } catch (error) {
      this.logger.error(`❌ Error checking Scorecard data existence for ${owner}/${repo}:`, error.message);
      return false;
    }
  }

  /**
   * Get a summary of Scorecard checks for a repository
   */
  async getScorecardSummary(owner: string, repo: string): Promise<{
    score: number;
    totalChecks: number;
    passedChecks: number;
    failedChecks: number;
    checkDetails: Array<{ name: string; score: number; reason: string }>;
  } | null> {
    const scorecardData = await this.getLatestScorecard(owner, repo);
    
    if (!scorecardData) {
      return null;
    }

    const checks = scorecardData.checks || [];
    const passedChecks = checks.filter(check => check.score > 0).length;
    const failedChecks = checks.filter(check => check.score === 0).length;

    return {
      score: scorecardData.score,
      totalChecks: checks.length,
      passedChecks,
      failedChecks,
      checkDetails: checks.map(check => ({
        name: check.name,
        score: check.score,
        reason: check.reason,
      })),
    };
  }

  /**
   * Get a summary of available Scorecard data for a repository
   */
  async getScorecardDataSummary(owner: string, repo: string): Promise<{
    hasData: boolean;
    totalRecords: number;
    dateRange: { start: string; end: string } | null;
    latestScore: number | null;
  }> {
    try {
      const repoUrl = `github.com/${owner}/${repo}`;
      
      const query = `
        SELECT 
          COUNT(*) as totalRecords,
          MIN(date) as startDate,
          MAX(date) as endDate,
          (
            SELECT score 
            FROM \`openssf.scorecardcron.scorecard-v2\` 
            WHERE repo.name = @repo 
            ORDER BY date DESC 
            LIMIT 1
          ) as latestScore
        FROM \`openssf.scorecardcron.scorecard-v2\`
        WHERE repo.name = @repo
      `;

      const options = {
        query,
        params: { repo: repoUrl },
        location: 'US',
      };

      const [job] = await this.bigquery.createQueryJob(options);
      const [rows] = await job.getQueryResults();

      const row = rows[0];
      const hasData = row.totalRecords > 0;

      return {
        hasData,
        totalRecords: row.totalRecords || 0,
        dateRange: hasData ? {
          start: row.startDate,
          end: row.endDate
        } : null,
        latestScore: row.latestScore || null,
      };
    } catch (error) {
      this.logger.error(`❌ Error getting Scorecard data summary for ${owner}/${repo}:`, error.message);
      return {
        hasData: false,
        totalRecords: 0,
        dateRange: null,
        latestScore: null,
      };
    }
  }
} 