import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { GitManagerService } from '../services/git-manager.service';

import { HealthAnalysisService } from '../services/health-analysis.service';
import { RateLimitManagerService } from '../services/rate-limit-manager.service';
import { GitHubApiService } from '../services/github-api.service';
import { BusFactorService } from '../services/bus-factor.service';
import {
  ActivityAnalysisService,
  CommitData,
} from '../services/activity-analysis.service';
import { RepositorySummaryService } from '../services/repository-summary.service';

interface RepositorySetupJobData {
  watchlistId: string;
  owner: string;
  repo: string;
  branch: string;
  isLargeRepo: boolean;
  repoSizeKB: number;
  maxCommits?: number; // Optional override for commit count
  forceLocalCloning?: boolean; // Force local cloning instead of API
  forceLocalHealthAnalysis?: boolean; // Force local health analysis instead of Scorecard
}

@Processor('repository-setup')
export class RepositorySetupProcessor {
  private readonly logger = new Logger(RepositorySetupProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gitManager: GitManagerService,
    private readonly healthAnalysisService: HealthAnalysisService,
    private readonly rateLimitManager: RateLimitManagerService,
    private readonly githubApi: GitHubApiService,
    private readonly busFactorService: BusFactorService,
    private readonly activityAnalysisService: ActivityAnalysisService,
    private readonly repositorySummaryService: RepositorySummaryService,
  ) {}

  @Process('clone-and-analyze')
  async handleRepositorySetup(job: Job<RepositorySetupJobData>) {
    const {
      watchlistId,
      owner,
      repo,
      branch,
      isLargeRepo,
      repoSizeKB,
      maxCommits,
      forceLocalCloning,
      forceLocalHealthAnalysis,
    } = job.data;
    const startTime = Date.now();
    let repoPath: string | null = null; // Declare at function level for cleanup access

    this.logger.log(
      `🚀 Starting repository setup for ${owner}/${repo} (watchlist: ${watchlistId})`,
    );

    try {
      await this.prisma.watchlist.update({
        where: { watchlist_id: watchlistId },
        data: {
          status: 'processing',
          processing_started_at: new Date(),
          last_error: null,
        },
      });

      // TODO: Rate limiting logic commented out for simplification - will optimize later
      // const strategy = await this.rateLimitManager.getProcessingStrategy();
      // const rateLimit = await this.rateLimitManager.getRateLimitStatus();
      // this.logger.log(`🎯 Using ${strategy.reason.split('(')[0].trim()} (${rateLimit.remaining}/${rateLimit.limit} remaining)`);

      // Check if we should use API for this specific repository (unless forced to use local)
      // const shouldUseApiForRepo = forceLocalCloning ? false : await this.rateLimitManager.shouldUseApiForRepo(repoSizeKB);
      // const shouldUseApiForCommits = forceLocalCloning ? false : shouldUseApiForRepo; // Use repo-specific decision instead of global

      // For now, always use local cloning for commits
      const shouldUseApiForCommits = false;

      let commitCount = 0;

      const twoYearsAgo = new Date();
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
      const now = new Date();

      // Step 1: Fetch Scorecard data and repository info in parallel
      let historicalScorecardData: any[] = [];
      let repositoryInfo: any = null;

      // Start all operations in parallel
      const parallelOperations: Promise<{
        type: string;
        data?: any;
        error?: any;
      }>[] = [];

      // TODO: GitHub API commit fetching commented out - always using local cloning
      // if (shouldUseApiForCommits) {
      //   this.logger.log(`📡 Fetching commits via GitHub API (max: ${maxCommits || 2000})`);
      //   parallelOperations.push(
      //     this.githubApi.getLatestCommits(owner, repo, branch, maxCommits || 2000)
      //       .then(result => ({ type: 'commits', data: result }))
      //       .catch(error => ({ type: 'commits', error }))
      //   );
      // }

      // Scorecard API calls removed - using local analysis only

      // Start repository info fetch in parallel
      this.logger.log(`📊 Fetching repository info for ${owner}/${repo}`);
      parallelOperations.push(
        this.githubApi
          .getRepositoryInfo(owner, repo)
          .then((data) => ({ type: 'repository', data }))
          .catch((error) => ({ type: 'repository', error })),
      );

      // Wait for parallel operations to complete
      const results = await Promise.all(parallelOperations);

      // TODO: GitHub API commit processing commented out - always using local cloning
      // const commitResult = results.find(r => r.type === 'commits');
      // if (commitResult && !commitResult.error) {
      //   commitsResult = commitResult.data;
      // } else if (commitResult?.error) {
      //   this.logger.warn(`⚠️ GitHub API failed, will fall back to local cloning: ${commitResult.error.message}`);
      // }

      // Scorecard processing removed - using local analysis only

      // Process repository info results
      const repoInfoResult = results.find((r) => r.type === 'repository');
      if (repoInfoResult && !repoInfoResult.error) {
        repositoryInfo = repoInfoResult.data;
      } else if (repoInfoResult?.error) {
        this.logger.warn(
          `⚠️ Repository info API failed: ${repoInfoResult.error.message}`,
        );
      }

      // Always use local cloning for commit fetching
      this.logger.log(`💾 Using local cloning for commit fetching`);
      repoPath = await this.gitManager.cloneRepository(owner, repo, branch);
      const commitResult = await this.gitManager.backfillCommitsForRepo(
        owner,
        repo,
        branch,
        watchlistId,
      );
      commitCount = commitResult.commitCount;
      const commitsForHealthAnalysis = commitResult.commits;
      this.logger.log(
        `📝 Logged ${commitCount} commits to database (from local cloning)`,
      );

      // Step 2: Calculate repository and contributor statistics
      if (commitCount > 0) {
        try {
          this.logger.log(`📊 Calculating repository and contributor statistics...`);
          await this.gitManager.updateContributorStats(watchlistId);
          this.logger.log(`✅ Repository and contributor statistics calculated successfully`);
        } catch (error) {
          this.logger.error(`❌ Failed to calculate repository and contributor statistics: ${error.message}`);
          // Don't fail the entire process if stats calculation fails
        }
      } else {
        this.logger.log(`📊 No commits found, skipping statistics calculation`);
      }

      // Step 3: Always use local health analysis (BigQuery disabled)
      this.logger.log(
        `🧪 Using local health analysis (BigQuery disabled)`,
      );

      // Always run health analysis, even if no commits (to get current health metrics)
      if (commitsForHealthAnalysis.length === 0) {
        this.logger.log(
          `📊 No commits found, running health analysis on repository head`,
        );
        const currentHealth =
          await this.healthAnalysisService.analyzeRepository(
            watchlistId,
            owner,
            repo,
            branch,
          );
        this.logger.log(
          `   📈 ${new Date().toISOString().split('T')[0]}: ${(currentHealth / 10).toFixed(1)}/10`,
        );
        historicalScorecardData = [
          {
            date: new Date().toISOString(),
            score: currentHealth,
            commitSha: 'HEAD',
            source: 'local-analysis-current',
          },
        ];
      } else {
        const transformedCommits = this.transformCommitsForHealthAnalysis(
          commitsForHealthAnalysis,
        );
        const localAnalysis =
          await this.healthAnalysisService.runHistoricalHealthAnalysis(
            watchlistId,
            owner,
            repo,
            transformedCommits,
            branch,
          );
        historicalScorecardData = localAnalysis.historical.map((result) => ({
          date: result.date.toISOString(),
          score: result.score,
          commitSha: result.commitSha,
          scorecardMetrics: result.scorecardMetrics,
          source: 'local-analysis',
        }));
      }

      // Store health data in new table (local analysis results only)
      if (historicalScorecardData.length > 0) {
        this.logger.log(
          `📊 Storing ${historicalScorecardData.length} health data records in database`,
        );

        for (const healthRecord of historicalScorecardData) {
          // Parse the date - Scorecard data is already a Date object from our service
          let commitDate: Date;
          try {
            if (typeof healthRecord.date === 'string') {
              // If it's a date string like "2025-07-14", append time to make it valid
              const dateStr = healthRecord.date.includes('T')
                ? healthRecord.date
                : `${healthRecord.date}T00:00:00Z`;
              commitDate = new Date(dateStr);
            } else {
              commitDate = new Date(healthRecord.date);
            }

            // Validate the date
            if (isNaN(commitDate.getTime())) {
              this.logger.warn(
                `⚠️ Invalid date from Scorecard: "${healthRecord.date}", using current date`,
              );
              commitDate = new Date();
            }
          } catch (error) {
            this.logger.warn(
              `⚠️ Error parsing date from Scorecard: "${healthRecord.date}", using current date`,
            );
            commitDate = new Date();
          }

          await this.prisma.healthData.create({
            data: {
              watchlist_id: watchlistId,
              commit_sha: healthRecord.commitSha || null, // Can be null for Scorecard data
              commit_date: commitDate,
              scorecard_metrics:
                healthRecord.checks || healthRecord.scorecardMetrics || null, // Handle both Scorecard and local analysis
              overall_health_score: healthRecord.score,
              source: healthRecord.source || 'scorecard',
              analysis_date: new Date(),
            },
          });
        }

        this.logger.log(
          `✅ ${historicalScorecardData.length} health data records stored in database`,
        );
      }

      // Step 4: Calculate bus factor
      let busFactorResult: any = null;
      if (commitCount > 0) {
        try {
          this.logger.log(`📊 Calculating bus factor for ${owner}/${repo}`);
          busFactorResult =
            await this.busFactorService.calculateBusFactor(watchlistId);
          await this.busFactorService.storeBusFactorResults(
            watchlistId,
            busFactorResult,
          );

          // Store bus factor data in new table
          await this.prisma.busFactorData.create({
            data: {
              watchlist_id: watchlistId,
              bus_factor: busFactorResult.busFactor,
              total_contributors: busFactorResult.totalContributors,
              total_commits: busFactorResult.totalCommits,
              top_contributors: busFactorResult.topContributors,
              risk_level: busFactorResult.riskLevel,
              risk_reason: busFactorResult.riskReason,
              analysis_date: new Date(),
            },
          });
          this.logger.log(`✅ Bus factor data stored in database`);
        } catch (error) {
          this.logger.error(
            `❌ Bus factor calculation failed: ${error.message}`,
          );
        }
      } else {
        this.logger.log(
          `📊 Skipping bus factor calculation (no commits available)`,
        );
      }

      // Step 5: Run activity analysis
      let activityAnalysisResult: any = null;
      let weeklyCommitRate: number = 0;
      if (commitCount > 0) {
        try {
          this.logger.log(`📈 Running activity analysis for ${owner}/${repo}`);

          // Fetch commits from database for activity analysis (more efficient)
          const commitsForAnalysis = await this.getCommitsFromDatabaseForActivityAnalysis(watchlistId);

          // Calculate activity score
          const activityScore =
            this.activityAnalysisService.calculateActivityScore(
              commitsForAnalysis,
            );

          // Log detailed activity score breakdown
          this.logger.log(`📊 Activity Score Breakdown for ${owner}/${repo}:`);
          this.logger.log(`   Total Score: ${activityScore.score}/100 (${activityScore.level})`);
          this.logger.log(`   Factors:`);
          this.logger.log(`     - Commit Frequency: ${activityScore.factors.commitFrequency}/25`);
          this.logger.log(`     - Contributor Diversity: ${activityScore.factors.contributorDiversity}/25`);
          this.logger.log(`     - Code Churn: ${activityScore.factors.codeChurn}/25`);
          this.logger.log(`     - Development Consistency: ${activityScore.factors.developmentConsistency}/25`);

          // Log the raw data that led to these scores
          const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
          const recentCommits = commitsForAnalysis.filter(c => c.date >= threeMonthsAgo);
          const recentContributors = new Set(recentCommits.map(c => c.author));
          const totalLinesChanged = recentCommits.reduce((sum, c) => sum + c.linesAdded + c.linesDeleted, 0);
          const avgLinesPerCommit = recentCommits.length > 0 ? totalLinesChanged / recentCommits.length : 0;
          const weeklyRateForLogging = this.activityAnalysisService.calculateWeeklyCommitRate(recentCommits);

          this.logger.log(`   Raw Data (Last 3 Months):`);
          this.logger.log(`     - Recent Commits: ${recentCommits.length} (${(recentCommits.length / 3).toFixed(1)}/month)`);
          this.logger.log(`     - Unique Contributors: ${recentContributors.size}`);
          this.logger.log(`     - Total Lines Changed: ${totalLinesChanged}`);
          this.logger.log(`     - Avg Lines/Commit: ${avgLinesPerCommit.toFixed(1)}`);
          this.logger.log(`     - Weekly Commit Rate: ${weeklyRateForLogging.toFixed(2)} commits/week`);
          this.logger.log(`     - Date Range: ${threeMonthsAgo.toISOString().split('T')[0]} to ${new Date().toISOString().split('T')[0]}`);

          // Log calculation explanations
          this.logger.log(`   Factor Calculations:`);
          this.logger.log(`     - Commit Frequency: ${(recentCommits.length / 3).toFixed(1)} commits/month → ${Math.min((recentCommits.length / 3) / 15, 1) * 25}/25 points (15+ commits/month = max)`);
          this.logger.log(`     - Contributor Diversity: ${recentContributors.size} contributors → ${Math.min(recentContributors.size / 5, 1) * 25}/25 points (5+ contributors = max)`);
          this.logger.log(`     - Code Churn: ${avgLinesPerCommit.toFixed(1)} lines/commit → ${Math.min(avgLinesPerCommit / 50, 1) * 25}/25 points (50+ lines/commit = max)`);
          this.logger.log(`     - Development Consistency: ${weeklyRateForLogging.toFixed(2)} commits/week → ${Math.min(weeklyRateForLogging / 3, 1) * 25}/25 points (3+ commits/week = max)`);

          // Analyze file churn
          const fileChurnData =
            this.activityAnalysisService.analyzeFileChurn(commitsForAnalysis);

          // Generate activity heatmap
          const activityHeatmap =
            this.activityAnalysisService.generateActivityHeatmap(
              commitsForAnalysis,
            );

          // Calculate weekly commit rate
          weeklyCommitRate =
            this.activityAnalysisService.calculateWeeklyCommitRate(
              commitsForAnalysis,
            );

          // Create the activity analysis result first
          activityAnalysisResult = {
            activityScore,
            fileChurnData: this.activityAnalysisService.getTopActiveFiles(
              fileChurnData,
              10,
            ),
            activityHeatmap,
            totalFilesAnalyzed: fileChurnData.length,
          };

          // Store activity data in new table
          await this.prisma.activityData.create({
            data: {
              watchlist_id: watchlistId,
              activity_score: activityScore.score,
              activity_level: activityScore.level,
              weekly_commit_rate: weeklyCommitRate,
              activity_factors: JSON.parse(JSON.stringify(activityScore.factors)),
              activity_heatmap: JSON.parse(JSON.stringify(activityHeatmap)),
              peak_activity: {
                day: activityHeatmap.peakActivity.day,
                hour: activityHeatmap.peakActivity.hour,
                count: activityHeatmap.peakActivity.count,
              },
              analysis_date: new Date(),
            },
          });
          this.logger.log(`✅ Activity data stored in database`);

          // Get activity summary for logging
          const activitySummary =
            this.activityAnalysisService.getActivitySummary(
              activityScore,
              fileChurnData,
              activityHeatmap,
              weeklyCommitRate,
            );

          this.logger.log(`📊 Activity Analysis: ${activitySummary}`);
        } catch (error) {
          this.logger.error(`❌ Activity analysis failed: ${error.message}`);
        }
      } else {
        this.logger.log(`📈 Skipping activity analysis (no commits available)`);
      }

      // Step 6: Generate AI summary using existing data
      let aiSummaryResult: any = null;
      try {
        this.logger.log(`🤖 Generating AI summary for ${owner}/${repo}`);

        // Use the data we already collected instead of making new API calls
        const repoData = {
          name: `${owner}/${repo}`,
          description:
            repositoryInfo?.description || 'No description available',
          stars: repositoryInfo?.stargazers_count || 0,
          forks: repositoryInfo?.forks_count || 0,
          contributors: busFactorResult?.totalContributors || 0,
          language: repositoryInfo?.language || 'Unknown',
          topics: repositoryInfo?.topics || [],
          lastCommitDate:
            commitsForHealthAnalysis.length > 0
              ? new Date(commitsForHealthAnalysis[0].date)
              : undefined,
          commitCount: commitCount,

          // Enhanced bus factor data
          busFactor: busFactorResult?.busFactor || 0,
          busFactorRiskLevel: busFactorResult?.riskLevel || 'UNKNOWN',
          busFactorRiskReason: busFactorResult?.riskReason || '',
          topContributors: busFactorResult?.topContributors || [],

          // Health analysis data
          healthAnalysis: {
            metricsCount: historicalScorecardData.length,
            latestHealthScore:
              historicalScorecardData.length > 0
                ? historicalScorecardData[historicalScorecardData.length - 1]
                    .score
                : 0,
            healthTrend:
              historicalScorecardData.length > 1
                ? this.calculateHealthTrend(historicalScorecardData)
                : 'stable',
            healthSource:
              historicalScorecardData.length > 0
                ? historicalScorecardData[0].source
                : 'unknown',
            recentHealthScores: historicalScorecardData
              .slice(-5)
              .map((record) => ({
                date: record.date,
                score: record.score,
                source: record.source,
              })),
          },

          // Activity analysis data
          activityAnalysis: activityAnalysisResult
            ? {
                activityScore: activityAnalysisResult.activityScore.score,
                activityLevel: activityAnalysisResult.activityScore.level,
                weeklyCommitRate: weeklyCommitRate,
                peakActivity:
                  activityAnalysisResult.activityHeatmap.peakActivity,
                activityFactors: activityAnalysisResult.activityScore.factors,
                totalFilesAnalyzed: activityAnalysisResult.totalFilesAnalyzed,
              }
            : null,

          recentCommits: commitsForHealthAnalysis.slice(0, 5).map((commit) => ({
            message: commit.message,
            author: commit.author,
            date: new Date(commit.date),
            filesChanged: 0,
          })),
        };

        aiSummaryResult =
          await this.repositorySummaryService.generateSummaryWithData(repoData);

        if (aiSummaryResult) {
          this.logger.log(
            `✅ AI summary generated: "${aiSummaryResult.summary.substring(0, 50)}..." (confidence: ${aiSummaryResult.confidence})`,
          );

          // Store AI summary data in new table
          await this.prisma.aISummaryData.create({
            data: {
              watchlist_id: watchlistId,
              summary: aiSummaryResult.summary,
              confidence: aiSummaryResult.confidence,
              model_used: aiSummaryResult.modelUsed || 'gemma2:2b',
              prompt_length: aiSummaryResult.promptLength,
              output_length: aiSummaryResult.outputLength,
              generation_time_ms: aiSummaryResult.generationTimeMs,
            },
          });
          this.logger.log(`✅ AI summary data stored in database`);
        } else {
          this.logger.warn(`⚠️ AI summary generation failed, using fallback`);
        }
      } catch (error) {
        this.logger.error(`❌ AI summary generation failed: ${error.message}`);
      }

      await this.prisma.watchlist.update({
        where: { watchlist_id: watchlistId },
        data: {
          status: 'ready',
          processing_completed_at: new Date(),
          commits_since_last_health_update: 0, // Fixed: should be 0, not commitCount
          last_error: null,
          latest_commit_sha:
            commitsForHealthAnalysis.length > 0
              ? commitsForHealthAnalysis[0].sha
              : null, // Store latest commit SHA
        },
      });

      // Clean up local repository if we cloned it
      if (repoPath) {
        await this.gitManager.cleanupRepository(owner, repo);
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      const healthMetricsCount = historicalScorecardData.length;
      const busFactorInfo = busFactorResult
        ? {
            busFactor: busFactorResult.busFactor,
            riskLevel: busFactorResult.riskLevel,
            totalContributors: busFactorResult.totalContributors,
          }
        : null;
      const activityInfo = activityAnalysisResult
        ? {
            activityScore: activityAnalysisResult.activityScore.score,
            activityLevel: activityAnalysisResult.activityScore.level,
            topFilesCount: activityAnalysisResult.fileChurnData.length,
            peakActivity: activityAnalysisResult.activityHeatmap.peakActivity,
            weeklyCommitRate: weeklyCommitRate,
          }
        : null;

      this.logger.log(
        `✅ Repository setup completed in ${duration}s - ${commitCount} commits retrieved, ${healthMetricsCount} health metrics retrieved${busFactorInfo ? `, bus factor: ${busFactorInfo.busFactor} (${busFactorInfo.riskLevel})` : ''}${activityInfo ? `, activity: ${activityInfo.activityScore}/100 (${activityInfo.activityLevel}), weekly rate: ${activityInfo.weeklyCommitRate.toFixed(2)} commits/week` : ''}`,
      );

      const result = {
        success: true,
        commitCount,
        healthMetricsCount,
        hasScorecardData: healthMetricsCount > 0,
        busFactor: busFactorInfo,
        activityAnalysis: activityAnalysisResult
          ? {
              ...activityAnalysisResult,
              weeklyCommitRate,
            }
          : null,
        aiSummary: aiSummaryResult
          ? {
              summary: aiSummaryResult.summary,
              confidence: aiSummaryResult.confidence,
              model: aiSummaryResult.modelUsed,
            }
          : null,
        strategy: 'local-cloning-only', // TODO: strategy.reason commented out
        usedApiForCommits: false, // Always using local cloning now
        usedLocalCloning: true, // Always using local cloning now
        duration: `${duration}s`,
      };

      return result;
    } catch (error) {
      this.logger.error(
        `❌ Repository setup failed for ${owner}/${repo}:`,
        error.message,
      );

      // Always clean up the repository on failure
      if (repoPath) {
        try {
          await this.gitManager.cleanupRepository(owner, repo);
          this.logger.log(
            `🧹 Cleaned up repository ${owner}/${repo} after failure`,
          );
        } catch (cleanupError) {
          this.logger.warn(
            `⚠️ Failed to clean up repository ${owner}/${repo}: ${cleanupError.message}`,
          );
        }
      }

      await this.prisma.watchlist.update({
        where: { watchlist_id: watchlistId },
        data: { status: 'failed', last_error: error.message },
      });

      this.logger.log(`💥 Job failed for ${owner}/${repo}`);

      throw error;
    }
  }

  /**
   * Log commits to database from GitHub API data with optimized processing
   */
  private async logCommitsToDatabase(
    watchlistId: string,
    commits: any[],
  ): Promise<void> {
    try {
      this.logger.log(
        `🔄 Processing ${commits.length} commits in batches of 1000`,
      );

      // Get the last log entry for this repository to start the hash chain
      const lastLog = await this.prisma.log.findFirst({
        where: { watchlist_id: watchlistId },
        orderBy: { timestamp: 'desc' },
      });

      let currentPrevHash = lastLog ? lastLog.event_hash : null;
      let processedCount = 0;
      let skippedCount = 0;
      const batchSize = 100; // Reduced batch size to avoid connection pool exhaustion

      for (let i = 0; i < commits.length; i += batchSize) {
        const batch = commits.slice(i, i + batchSize);

        // Check for existing commits first to avoid unnecessary operations
        const eventIds = batch.map((commit) => `commit_${commit.sha}`);
        const existingLogs = await this.prisma.log.findMany({
          where: {
            event_id: { in: eventIds },
            watchlist_id: watchlistId,
          },
          select: { event_id: true },
        });

        const existingEventIds = new Set(
          existingLogs.map((log) => log.event_id),
        );

        // Process only new commits
        const newCommits = batch.filter(
          (commit) => !existingEventIds.has(`commit_${commit.sha}`),
        );

        if (newCommits.length === 0) {
          skippedCount += batch.length;
          continue;
        }

        // Process new commits in batches for better performance
        const batchData = newCommits.map((commit) => {
          const payload = {
            sha: commit.sha,
            message: commit.commit.message,
            author: commit.commit.author.name,
            author_email: commit.commit.author.email,
            committer: commit.commit.committer.name,
            committer_email: commit.commit.committer.email,
            date: commit.commit.author.date,
            parents: commit.parents.map((p: any) => p.sha),
          };

          const logData = {
            watchlist_id: watchlistId,
            event_type: 'COMMIT',
            actor: commit.commit.author.name,
            timestamp: new Date(commit.commit.author.date),
            payload,
            prev_event_hash: currentPrevHash,
          };

          const eventHash = this.createEventHash(logData);

          // Update prev hash for next iteration
          const prevHash = currentPrevHash;
          currentPrevHash = eventHash;

          return {
            event_id: `commit_${commit.sha}`,
            event_type: 'COMMIT',
            actor: commit.commit.author.name,
            timestamp: new Date(commit.commit.author.date),
            payload,
            event_hash: eventHash,
            prev_event_hash: prevHash,
            watchlist_id: watchlistId,
            // Note: GitHub API doesn't provide diff data in basic commit endpoint
            // We'll need to make additional API calls to get file changes
            files_changed: 0, // Will be updated if we fetch diff data
            lines_added: 0, // Will be updated if we fetch diff data
            lines_deleted: 0, // Will be updated if we fetch diff data
            diff_data: undefined, // Will be updated if we fetch diff data
          };
        });

        // Batch insert all commits at once
        await this.prisma.log.createMany({
          data: batchData,
          skipDuplicates: true, // Skip if any duplicates exist
        });

        processedCount += newCommits.length;
        skippedCount += batch.length - newCommits.length;

        this.logger.log(
          `📊 Batch ${Math.floor(i / batchSize) + 1}: Processed ${newCommits.length} new commits, skipped ${batch.length - newCommits.length} existing`,
        );

        // Small delay between batches to prevent connection pool exhaustion
        if (i + batchSize < commits.length) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }

      this.logger.log(
        `✅ Commit logging completed: ${processedCount} processed, ${skippedCount} skipped`,
      );
    } catch (error) {
      this.logger.error(`❌ Error logging commits to database:`, error.message);
      throw error;
    }
  }

  /**
   * Transform commits to the format expected by health analysis
   * Handles both GitHub API format and local git format
   */
  private transformCommitsForHealthAnalysis(commits: any[]): any[] {
    return commits.map((commit) => {
      // Handle GitHub API format (nested commit structure)
      if (commit.commit && commit.commit.author) {
        return {
          sha: commit.sha,
          date: commit.commit.author.date,
          message: commit.commit.message,
          author: commit.commit.author.name,
          author_email: commit.commit.author.email,
          committer: commit.commit.committer.name,
          committer_email: commit.commit.committer.email,
          parents: commit.parents?.map((p: any) => p.sha) || [],
        };
      }

      // Handle local git format (flat structure)
      return {
        sha: commit.sha,
        date: commit.date,
        message: commit.message,
        author: commit.author,
        author_email: commit.email,
        committer: commit.author, // Local git doesn't separate committer
        committer_email: commit.email,
        parents: [], // Local git doesn't provide parents in this format
      };
    });
  }

  /**
   * Fetch commits from database for activity analysis
   * This is more efficient than re-processing commits
   */
  private async getCommitsFromDatabaseForActivityAnalysis(watchlistId: string): Promise<CommitData[]> {
    const commits = await this.prisma.log.findMany({
      where: {
        watchlist_id: watchlistId,
        event_type: 'COMMIT',
      },
      orderBy: { timestamp: 'desc' },
      select: {
        actor: true,
        timestamp: true,
        payload: true,
      },
    });

    return commits.map((log) => {
      const payload = log.payload as any;
      return {
        sha: payload.sha,
        author: log.actor,
        email: payload.email || '',
        date: new Date(log.timestamp + 'Z'), // Ensure UTC interpretation
        message: payload.message,
        filesChanged: payload.files_changed || [],
        linesAdded: payload.lines_added || 0,
        linesDeleted: payload.lines_deleted || 0,
      };
    });
  }

  /**
   * Transform commits to the format expected by activity analysis
   * Uses local git format which includes line change information
   */
  private transformCommitsForActivityAnalysis(commits: any[]): CommitData[] {
    return commits.map((commit) => {
      // Handle local git format (from gitManager.getCommitsForRepo)
      // This format includes linesAdded, linesDeleted, and filesChanged
      return {
        sha: commit.sha,
        author: commit.author,
        email: commit.email,
        date: new Date(commit.date),
        message: commit.message,
        filesChanged: commit.filesChanged || [],
        linesAdded: commit.linesAdded || 0,
        linesDeleted: commit.linesDeleted || 0,
      };
    });
  }

  /**
   * Calculate health trend based on recent health scores
   */
  private calculateHealthTrend(healthData: any[]): string {
    if (healthData.length < 2) return 'stable';

    // Get the last 5 health scores for trend analysis
    const recentScores = healthData.slice(-5).map((record) => record.score);
    const firstScore = recentScores[0];
    const lastScore = recentScores[recentScores.length - 1];
    const scoreChange = lastScore - firstScore;

    // Calculate average change per record
    const avgChange = scoreChange / (recentScores.length - 1);

    if (avgChange > 0.5) return 'improving';
    if (avgChange < -0.5) return 'declining';
    return 'stable';
  }

  /**
   * Create a hash for a log event (hash chain)
   */
  private createEventHash(logData: any): string {
    const { createHash } = require('crypto');
    const hash = createHash('sha256');
    hash.update(JSON.stringify(logData));
    return hash.digest('hex');
  }
}
