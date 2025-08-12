import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { GitManagerService } from '../services/git-manager.service';
import { HealthAnalysisService } from '../services/health-analysis.service';

import { GitHubApiService } from '../services/github-api.service';
import { BusFactorService } from '../services/bus-factor.service';
import {
  ActivityAnalysisService,
  CommitData,
} from '../services/activity-analysis.service';
import { RepositorySummaryService } from '../services/repository-summary.service';
import { AIAnomalyDetectionService } from '../services/ai-anomaly-detection.service';
import { VulnerabilityService } from '../services/vulnerability.service';

interface RepositorySetupJobData {
  watchlistId: string;
  owner: string;
  repo: string;
  branch: string;
  isLargeRepo: boolean;
  repoSizeKB: number;
  maxCommits?: number;
  forceLocalCloning?: boolean;
  forceLocalHealthAnalysis?: boolean;
}

@Processor('repository-setup')
export class RepositorySetupProcessor {
  private readonly logger = new Logger(RepositorySetupProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gitManager: GitManagerService,
    private readonly healthAnalysisService: HealthAnalysisService,

    private readonly githubApi: GitHubApiService,
    private readonly busFactorService: BusFactorService,
    private readonly activityAnalysisService: ActivityAnalysisService,
    private readonly repositorySummaryService: RepositorySummaryService,
    private readonly aiAnomalyDetectionService: AIAnomalyDetectionService,
    private readonly vulnerabilityService: VulnerabilityService,
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
    let repoPath: string | null = null;

    this.logger.log(`🚀 Starting repository setup for ${owner}/${repo} (watchlist: ${watchlistId})`);

    // Only check if already completed, allow reprocessing if failed or stuck
    const existingWatchlist = await this.prisma.watchlist.findUnique({
      where: { watchlist_id: watchlistId },
      select: { status: true, processing_completed_at: true }
    });

    if (existingWatchlist?.status === 'ready' && existingWatchlist.processing_completed_at) {
      this.logger.log(`⏭️ Repository ${owner}/${repo} (watchlist: ${watchlistId}) already processed and ready, skipping duplicate job`);
      return;
    }

    // Set status to processing immediately to prevent race conditions
    await this.prisma.watchlist.update({
      where: { watchlist_id: watchlistId },
      data: {
        status: 'processing',
        processing_started_at: new Date(),
        last_error: null,
      },
    });

    try {
      const shouldUseApiForCommits = false;
      let commitCount = 0;

      const twoYearsAgo = new Date();
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
      const now = new Date();

      let historicalScorecardData: any[] = [];
      let repositoryInfo: any = null;

      const parallelOperations: Promise<{
        type: string;
        data?: any;
        error?: any;
      }>[] = [];

      this.logger.log(`📊 Fetching repository info for ${owner}/${repo}`);
      parallelOperations.push(
        this.githubApi
          .getRepositoryInfo(owner, repo)
          .then((data) => ({ type: 'repository', data }))
          .catch((error) => ({ type: 'repository', error })),
      );

      const results = await Promise.all(parallelOperations);

      const repoInfoResult = results.find((r) => r.type === 'repository');
      if (repoInfoResult && !repoInfoResult.error) {
        repositoryInfo = repoInfoResult.data;
      } else if (repoInfoResult?.error) {
        this.logger.warn(`⚠️ Repository info API failed: ${repoInfoResult.error.message}`);
      }

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
      this.logger.log(`📝 Logged ${commitCount} commits to database (from local cloning)`);

      if (commitCount > 0) {
        try {
          this.logger.log(`📊 Calculating repository and contributor statistics...`);
          await this.gitManager.updateContributorStats(watchlistId);
          this.logger.log(`✅ Repository and contributor statistics calculated successfully`);
        } catch (error) {
          this.logger.error(`❌ Failed to calculate repository and contributor statistics: ${error.message}`);
        }
      } else {
        this.logger.log(`📊 No commits found, skipping statistics calculation`);
      }

      this.logger.log(`🧪 Using local health analysis (BigQuery disabled)`);

      if (commitsForHealthAnalysis.length === 0) {
        this.logger.log(`📊 No commits found, running health analysis on repository head`);
        const currentHealth = await this.healthAnalysisService.analyzeRepository(
          watchlistId,
          owner,
          repo,
          branch,
        );
        this.logger.log(`   📈 ${new Date().toISOString().split('T')[0]}: ${(currentHealth / 10).toFixed(1)}/10`);
        historicalScorecardData = [
          {
            date: new Date().toISOString(),
            score: currentHealth,
            commitSha: 'HEAD',
            source: 'local-analysis-current',
          },
        ];
      } else {
        const transformedCommits = this.transformCommitsForHealthAnalysis(commitsForHealthAnalysis);
        const localAnalysis = await this.healthAnalysisService.runHistoricalHealthAnalysis(
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

      if (historicalScorecardData.length > 0) {
        this.logger.log(`📊 Health analysis completed with ${historicalScorecardData.length} data points`);
        this.logger.log(`✅ Health data already stored by health analysis service`);
      }

      let busFactorResult: any = null;
      if (commitCount > 0) {
        try {
          this.logger.log(`📊 Calculating bus factor for ${owner}/${repo}`);
          busFactorResult = await this.busFactorService.calculateBusFactor(watchlistId);
          await this.busFactorService.storeBusFactorResults(watchlistId, busFactorResult);

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
          this.logger.error(`❌ Bus factor calculation failed: ${error.message}`);
        }
      } else {
        this.logger.log(`📊 Skipping bus factor calculation (no commits available)`);
      }

      let activityAnalysisResult: any = null;
      let weeklyCommitRate: number = 0;
      if (commitCount > 0) {
        try {
          this.logger.log(`📈 Running activity analysis for ${owner}/${repo}`);

          const commitsForAnalysis = await this.getCommitsFromDatabaseForActivityAnalysis(watchlistId);
          const activityScore = this.activityAnalysisService.calculateActivityScore(commitsForAnalysis);

          this.logger.log(`📊 Activity Score Breakdown for ${owner}/${repo}:`);
          this.logger.log(`   Total Score: ${activityScore.score}/100 (${activityScore.level})`);
          this.logger.log(`   Factors:`);
          this.logger.log(`     - Commit Frequency: ${activityScore.factors.commitFrequency}/25`);
          this.logger.log(`     - Contributor Diversity: ${activityScore.factors.contributorDiversity}/25`);
          this.logger.log(`     - Code Churn: ${activityScore.factors.codeChurn}/25`);
          this.logger.log(`     - Development Consistency: ${activityScore.factors.developmentConsistency}/25`);

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

          this.logger.log(`   Factor Calculations:`);
          this.logger.log(`     - Commit Frequency: ${(recentCommits.length / 3).toFixed(1)} commits/month → ${Math.min((recentCommits.length / 3) / 15, 1) * 25}/25 points (15+ commits/month = max)`);
          this.logger.log(`     - Contributor Diversity: ${recentContributors.size} contributors → ${Math.min(recentContributors.size / 5, 1) * 25}/25 points (5+ contributors = max)`);
          this.logger.log(`     - Code Churn: ${avgLinesPerCommit.toFixed(1)} lines/commit → ${Math.min(avgLinesPerCommit / 50, 1) * 25}/25 points (50+ lines/commit = max)`);
          this.logger.log(`     - Development Consistency: ${weeklyRateForLogging.toFixed(2)} commits/week → ${Math.min(weeklyRateForLogging / 3, 1) * 25}/25 points (3+ commits/week = max)`);

          const fileChurnData = this.activityAnalysisService.analyzeFileChurn(commitsForAnalysis);
          const activityHeatmap = this.activityAnalysisService.generateActivityHeatmap(commitsForAnalysis);
          weeklyCommitRate = this.activityAnalysisService.calculateWeeklyCommitRate(commitsForAnalysis);

          activityAnalysisResult = {
            activityScore,
            fileChurnData: this.activityAnalysisService.getTopActiveFiles(fileChurnData, 10),
            activityHeatmap,
            totalFilesAnalyzed: fileChurnData.length,
          };

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

          const activitySummary = this.activityAnalysisService.getActivitySummary(
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

      let aiSummaryResult: any = null;
      try {
        this.logger.log(`🤖 Generating AI summary for ${owner}/${repo}`);

        const repoData = {
          name: `${owner}/${repo}`,
          description: repositoryInfo?.description || 'No description available',
          stars: repositoryInfo?.stargazers_count || 0,
          forks: repositoryInfo?.forks_count || 0,
          contributors: busFactorResult?.totalContributors || 0,
          language: repositoryInfo?.language || 'Unknown',
          topics: repositoryInfo?.topics || [],
          lastCommitDate: commitsForHealthAnalysis.length > 0
            ? new Date(commitsForHealthAnalysis[0].date)
            : undefined,
          commitCount: commitCount,
          busFactor: busFactorResult?.busFactor || 0,
          busFactorRiskLevel: busFactorResult?.riskLevel || 'UNKNOWN',
          busFactorRiskReason: busFactorResult?.riskReason || '',
          topContributors: busFactorResult?.topContributors || [],
          healthAnalysis: {
            metricsCount: historicalScorecardData.length,
            latestHealthScore: historicalScorecardData.length > 0
              ? historicalScorecardData[historicalScorecardData.length - 1].score
              : 0,
            healthTrend: historicalScorecardData.length > 1
              ? this.calculateHealthTrend(historicalScorecardData)
              : 'stable',
            healthSource: historicalScorecardData.length > 0
              ? historicalScorecardData[0].source
              : 'unknown',
            recentHealthScores: historicalScorecardData.slice(-5).map((record) => ({
              date: record.date,
              score: record.score,
              source: record.source,
            })),
          },
          activityAnalysis: activityAnalysisResult
            ? {
                activityScore: activityAnalysisResult.activityScore.score,
                activityLevel: activityAnalysisResult.activityScore.level,
                weeklyCommitRate: weeklyCommitRate,
                peakActivity: activityAnalysisResult.activityHeatmap.peakActivity,
                activityFactors: activityAnalysisResult.activityScore.factors,
                totalFilesAnalyzed: activityAnalysisResult.totalFilesAnalyzed,
              }
            : null,
          activityScore: activityAnalysisResult?.activityScore.score,
          recentCommits: commitsForHealthAnalysis.slice(0, 5).map((commit) => ({
            message: commit.message,
            author: commit.author,
            date: new Date(commit.date),
            filesChanged: 0,
          })),
        };

        aiSummaryResult = await this.repositorySummaryService.generateSummaryWithData(repoData);

        if (aiSummaryResult) {
          this.logger.log(`✅ AI summary generated: "${aiSummaryResult.summary.substring(0, 50)}..." (confidence: ${aiSummaryResult.confidence})`);

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

      try {
        await this.runAIAnomalyDetection(watchlistId);
      } catch (error) {
        this.logger.error('Failed to run AI anomaly detection:', error);
      }

      try {
        await this.fetchAndStoreVulnerabilities(watchlistId, owner, repo);
      } catch (error) {
        this.logger.error('Failed to fetch vulnerability data:', error);
      }

      await this.prisma.watchlist.update({
        where: { watchlist_id: watchlistId },
        data: {
          status: 'ready',
          processing_completed_at: new Date(),
          commits_since_last_health_update: 0,
          last_error: null,
          latest_commit_sha: commitsForHealthAnalysis.length > 0
            ? commitsForHealthAnalysis[0].sha
            : null,
        },
      });

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
        strategy: 'local-cloning-only',
        usedApiForCommits: false,
        usedLocalCloning: true,
        duration: `${duration}s`,
      };

      return result;
    } catch (error) {
      this.logger.error(`❌ Repository setup failed for ${owner}/${repo}:`, error.message);

      if (repoPath) {
        try {
          await this.gitManager.cleanupRepository(owner, repo);
          this.logger.log(`🧹 Cleaned up repository ${owner}/${repo} after failure`);
        } catch (cleanupError) {
          this.logger.warn(`⚠️ Failed to clean up repository ${owner}/${repo}: ${cleanupError.message}`);
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

  private async runAIAnomalyDetection(watchlistId: string): Promise<void> {
    try {
      this.logger.log(`🔍 Starting AI anomaly detection for watchlist ${watchlistId}`);

      const commits = await this.prisma.log.findMany({
        where: {
          watchlist_id: watchlistId,
          event_type: 'COMMIT',
        },
        orderBy: { timestamp: 'desc' },
        take: 50,
      });

      if (commits.length === 0) {
        this.logger.log(`📝 No commits found for AI anomaly detection`);
        return;
      }

      this.logger.log(`🔍 Analyzing ${commits.length} commits for anomalies`);

      const contributorStats = await this.prisma.contributorStats.findMany({
        where: { watchlist_id: watchlistId },
      });

      const repoStats = await this.prisma.repoStats.findFirst({
        where: { watchlist_id: watchlistId },
      });

      for (const commit of commits) {
        try {
          const payload = commit.payload as any;
          
          const analysisData = {
            sha: payload.sha,
            author: commit.actor,
            email: payload.email || 'unknown@example.com',
            message: payload.message,
            date: commit.timestamp,
            linesAdded: payload.lines_added || 0,
            linesDeleted: payload.lines_deleted || 0,
            filesChanged: payload.files_changed || [],
            contributorStats: contributorStats.find(cs => cs.author_email === payload.email) ? {
              avgLinesAdded: contributorStats.find(cs => cs.author_email === payload.email)!.avg_lines_added,
              avgLinesDeleted: contributorStats.find(cs => cs.author_email === payload.email)!.avg_lines_deleted,
              avgFilesChanged: contributorStats.find(cs => cs.author_email === payload.email)!.avg_files_changed,
              stddevLinesAdded: contributorStats.find(cs => cs.author_email === payload.email)!.stddev_lines_added,
              stddevLinesDeleted: contributorStats.find(cs => cs.author_email === payload.email)!.stddev_lines_deleted,
              stddevFilesChanged: contributorStats.find(cs => cs.author_email === payload.email)!.stddev_files_changed,
              totalCommits: contributorStats.find(cs => cs.author_email === payload.email)!.total_commits,
            } : undefined,
            repoStats: repoStats ? {
              avgLinesAdded: repoStats.avg_lines_added,
              avgLinesDeleted: repoStats.avg_lines_deleted,
              avgFilesChanged: repoStats.avg_files_changed,
              totalCommits: repoStats.total_commits,
              totalContributors: contributorStats.length,
            } : undefined,
          };

          await this.aiAnomalyDetectionService.analyzeAndStoreAnomaly(watchlistId, analysisData);
        } catch (error) {
          this.logger.error(`Failed to analyze commit ${commit.event_id} for anomalies:`, error);
        }
      }

      this.logger.log(`✅ Completed AI anomaly detection for ${commits.length} commits`);
    } catch (error) {
      this.logger.error('Failed to run AI anomaly detection:', error);
    }
  }

  private transformCommitsForHealthAnalysis(commits: any[]): any[] {
    return commits.map((commit) => {
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

      return {
        sha: commit.sha,
        date: commit.date,
        message: commit.message,
        author: commit.author,
        author_email: commit.email,
        committer: commit.author,
        committer_email: commit.email,
        parents: [],
      };
    });
  }

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
        date: new Date(log.timestamp + 'Z'),
        message: payload.message,
        filesChanged: payload.files_changed || [],
        linesAdded: payload.lines_added || 0,
        linesDeleted: payload.lines_deleted || 0,
      };
    });
  }

  private calculateHealthTrend(healthData: any[]): string {
    if (healthData.length < 2) return 'stable';

    const recentScores = healthData.slice(-5).map((record) => record.score);
    const firstScore = recentScores[0];
    const lastScore = recentScores[recentScores.length - 1];
    const scoreChange = lastScore - firstScore;
    const avgChange = scoreChange / (recentScores.length - 1);

    if (avgChange > 0.5) return 'improving';
    if (avgChange < -0.5) return 'declining';
    return 'stable';
  }

  private async fetchAndStoreVulnerabilities(watchlistId: string, owner: string, repo: string): Promise<void> {
    try {
      this.logger.log(`🔍 Fetching vulnerability data for ${owner}/${repo}`);
      
      const watchlist = await this.prisma.watchlist.findUnique({
        where: { watchlist_id: watchlistId },
        include: { package: true }
      });

      if (!watchlist?.package) {
        this.logger.warn(`⚠️ No package found for watchlist ${watchlistId}`);
        return;
      }

      const packageName = watchlist.package.package_name;
      const repoUrl = watchlist.package.repo_url;

      const vulnerabilities = await this.vulnerabilityService.fetchVulnerabilities(packageName, repoUrl);
      
      if (vulnerabilities.length === 0) {
        this.logger.log(`✅ No vulnerabilities found for package: ${packageName}`);
        return;
      }

      const summary = this.vulnerabilityService.generateVulnerabilitySummary(vulnerabilities);
      await this.vulnerabilityService.storeVulnerabilities(watchlistId, vulnerabilities, summary);

      this.logger.log(`✅ Stored ${vulnerabilities.length} vulnerabilities for package: ${packageName}`);
    } catch (error) {
      this.logger.error(`❌ Failed to fetch/store vulnerabilities for ${owner}/${repo}:`, error.message);
      throw error;
    }
  }
}
