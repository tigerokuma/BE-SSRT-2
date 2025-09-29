import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';

export interface ContributorStats {
  author: string;
  email: string;
  totalCommits: number;
  totalLinesAdded: number;
  totalLinesDeleted: number;
  totalFilesChanged: number;
  firstCommit: Date;
  lastCommit: Date;
  contributionSpan: number;
  averageLinesPerCommit: number;
  averageFilesPerCommit: number;
}

export interface BusFactorResult {
  busFactor: number;
  totalContributors: number;
  totalCommits: number;
  topContributors: ContributorStats[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  riskReason: string;
  analysisDate: Date;
}

@Injectable()
export class BusFactorService {
  private readonly logger = new Logger(BusFactorService.name);

  constructor(private readonly prisma: PrismaService) {}

  async calculateBusFactor(watchlistId: string): Promise<BusFactorResult> {
    this.logger.log(`🚀 Starting bus factor calculation for ${watchlistId}`);

    try {
      const commits = await this.prisma.log.findMany({
        where: {
          watchlist_id: watchlistId,
          event_type: 'COMMIT',
        },
        orderBy: {
          timestamp: 'asc',
        },
        select: {
          actor: true,
          timestamp: true,
          payload: true,
        },
      });

      this.logger.log(
        `🔍 Found ${commits.length} total commits for ${watchlistId}`,
      );

      if (commits.length === 0) {
        return this.createEmptyResult();
      }

      const contributorStats = await this.analyzeContributors(
        commits,
        watchlistId,
      );
      const totalContributors = contributorStats.length;

      this.logger.log(
        `👥 Found ${totalContributors} human contributors for ${watchlistId}`,
      );

      if (totalContributors === 0) {
        return this.createEmptyResult();
      }

      const sortedContributors = contributorStats.sort(
        (a, b) => b.totalCommits - a.totalCommits,
      );

      this.logger.log(`🏆 Top 5 contributors:`);
      sortedContributors.slice(0, 5).forEach((contributor, index) => {
        this.logger.log(
          `  ${index + 1}. ${contributor.author}: ${contributor.totalCommits} commits`,
        );
      });

      const busFactor = this.calculateBusFactorScore(sortedContributors);
      const riskLevel = this.determineRiskLevel(
        busFactor,
        totalContributors,
        sortedContributors,
      );
      const totalCommits = sortedContributors.reduce(
        (sum, contributor) => sum + contributor.totalCommits,
        0,
      );

      this.logger.log(`🔢 Total commits (human only): ${totalCommits}`);

      const riskReason = this.getRiskReason(
        riskLevel,
        busFactor,
        totalContributors,
        sortedContributors,
      );

      const result: BusFactorResult = {
        busFactor,
        totalContributors,
        totalCommits,
        topContributors: sortedContributors.slice(0, 5),
        riskLevel,
        riskReason,
        analysisDate: new Date(),
      };

      this.logger.log(
        `✅ Bus factor calculation complete: ${busFactor} (${riskLevel}) for ${watchlistId}`,
      );
      return result;
    } catch (error) {
      this.logger.error(
        `❌ Bus factor calculation failed for ${watchlistId}:`,
        error,
      );
      throw error;
    }
  }

  private async analyzeContributors(
    commits: any[],
    watchlistId: string,
  ): Promise<ContributorStats[]> {
    const contributorMap = new Map<string, ContributorStats>();

    for (const commit of commits) {
      const author = commit.actor;
      const payload = commit.payload;
      const timestamp = new Date(commit.timestamp);

      if (this.isBotContributor(author)) {
        continue;
      }

      if (!contributorMap.has(author)) {
        contributorMap.set(author, {
          author,
          email: payload.email || '',
          totalCommits: 0,
          totalLinesAdded: 0,
          totalLinesDeleted: 0,
          totalFilesChanged: 0,
          firstCommit: timestamp,
          lastCommit: timestamp,
          contributionSpan: 0,
          averageLinesPerCommit: 0,
          averageFilesPerCommit: 0,
        });
      }

      const stats = contributorMap.get(author)!;
      stats.totalCommits++;

      if (timestamp < stats.firstCommit) {
        stats.firstCommit = timestamp;
      }
      if (timestamp > stats.lastCommit) {
        stats.lastCommit = timestamp;
      }
    }

    const sortedContributors = Array.from(contributorMap.values()).sort(
      (a, b) => b.totalCommits - a.totalCommits,
    );

    const topContributors = sortedContributors.slice(0, 5);
    this.logger.log(
      `📊 Getting lines changed data for top ${topContributors.length} contributors from contributor_stats`,
    );

    for (const contributor of topContributors) {
      try {
        const contributorStats = await this.prisma.contributorStats.findFirst({
          where: {
            author_name: contributor.author,
            watchlist_id: watchlistId,
          },
        });

        if (contributorStats) {
          contributor.totalLinesAdded = Math.round(
            contributorStats.avg_lines_added * contributorStats.total_commits,
          );
          contributor.totalLinesDeleted = Math.round(
            contributorStats.avg_lines_deleted * contributorStats.total_commits,
          );
          contributor.totalFilesChanged = Math.round(
            contributorStats.avg_files_changed * contributorStats.total_commits,
          );

          this.logger.log(
            `📊 ${contributor.author}: ${contributor.totalLinesAdded} added, ${contributor.totalLinesDeleted} deleted`,
          );
        } else {
          const contributorCommits = commits.filter(
            (c) => c.actor === contributor.author,
          );
          let totalLinesAdded = 0;
          let totalLinesDeleted = 0;
          let totalFilesChanged = 0;

          for (const commit of contributorCommits) {
            const payload = commit.payload;
            totalLinesAdded += payload.lines_added || 0;
            totalLinesDeleted += payload.lines_deleted || 0;
            totalFilesChanged += (payload.files_changed || []).length;
          }

          contributor.totalLinesAdded = totalLinesAdded;
          contributor.totalLinesDeleted = totalLinesDeleted;
          contributor.totalFilesChanged = totalFilesChanged;

          this.logger.log(
            `📊 ${contributor.author}: ${totalLinesAdded} added, ${totalLinesDeleted} deleted (from logs fallback)`,
          );
        }
      } catch (error) {
        this.logger.warn(
          `Could not get contributor stats for ${contributor.author}: ${error.message}`,
        );
      }
    }

    for (const stats of contributorMap.values()) {
      stats.contributionSpan = Math.ceil(
        (stats.lastCommit.getTime() - stats.firstCommit.getTime()) /
          (1000 * 60 * 60 * 24),
      );
      stats.averageLinesPerCommit =
        stats.totalCommits > 0
          ? Math.round(
              (stats.totalLinesAdded + stats.totalLinesDeleted) /
                stats.totalCommits,
            )
          : 0;
      stats.averageFilesPerCommit =
        stats.totalCommits > 0
          ? Math.round(stats.totalFilesChanged / stats.totalCommits)
          : 0;
    }

    return Array.from(contributorMap.values());
  }

  private isBotContributor(author: string): boolean {
    const botPatterns = [
      /github-actions/i,
      /\[bot\]/i,
      /dependabot/i,
      /renovate/i,
      /greenkeeper/i,
      /snyk/i,
      /travis/i,
      /circleci/i,
      /jenkins/i,
      /gitlab-ci/i,
      /azure-pipelines/i,
      /github-actions\[bot\]/i,
      /actions-user/i,
      /automation/i,
      /ci/i,
      /cd/i,
    ];

    return botPatterns.some((pattern) => pattern.test(author));
  }

  private calculateBusFactorScore(contributors: ContributorStats[]): number {
    if (contributors.length === 0) return 0;
    if (contributors.length === 1) return 1;

    const totalCommits = contributors.reduce(
      (sum, c) => sum + c.totalCommits,
      0,
    );
    if (totalCommits === 0) return 0;

    this.logger.log(`🔢 Total commits (human only): ${totalCommits}`);

    const topContributor = contributors[0];
    const topContributorPercentage = topContributor.totalCommits / totalCommits;

    this.logger.log(
      `👑 Top contributor: ${topContributor.author} with ${topContributor.totalCommits} commits (${(topContributorPercentage * 100).toFixed(1)}%)`,
    );

    if (topContributorPercentage > 0.5) {
      this.logger.log(
        `✅ Top contributor has >50% (${(topContributorPercentage * 100).toFixed(1)}%), returning bus factor = 1`,
      );
      return 1;
    }

    this.logger.log(
      `❌ Top contributor has ${(topContributorPercentage * 100).toFixed(1)}% (≤50%), calculating cumulative...`,
    );

    let cumulativeCommits = 0;
    let contributorsNeeded = 0;
    const targetCommits = totalCommits * 0.5;

    this.logger.log(`🎯 Target commits (50%): ${targetCommits}`);

    for (const contributor of contributors) {
      cumulativeCommits += contributor.totalCommits;
      contributorsNeeded++;

      this.logger.log(
        `  + ${contributor.author}: ${contributor.totalCommits} commits, Cumulative: ${cumulativeCommits}/${targetCommits}, Contributors needed: ${contributorsNeeded}`,
      );

      if (cumulativeCommits >= targetCommits) {
        this.logger.log(
          `✅ Reached target! Bus factor = ${contributorsNeeded}`,
        );
        break;
      }
    }

    return contributorsNeeded;
  }

  private determineRiskLevel(
    busFactor: number,
    totalContributors: number,
    contributors: ContributorStats[],
  ): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    const totalCommits = contributors.reduce(
      (sum, c) => sum + c.totalCommits,
      0,
    );
    const topContributorPercentage =
      totalCommits > 0 ? contributors[0]?.totalCommits / totalCommits : 0;

    if (
      totalContributors <= 2 ||
      busFactor === 1 ||
      topContributorPercentage > 0.8
    ) {
      return 'CRITICAL';
    }

    if (busFactor <= 3 || topContributorPercentage > 0.6) {
      return 'HIGH';
    }

    if (busFactor <= 6 || topContributorPercentage > 0.4) {
      return 'MEDIUM';
    }

    return 'LOW';
  }

  private getRiskReason(
    riskLevel: string,
    busFactor: number,
    totalContributors: number,
    contributors: ContributorStats[],
  ): string {
    const totalCommits = contributors.reduce(
      (sum, c) => sum + c.totalCommits,
      0,
    );
    const topContributorPercentage =
      totalCommits > 0
        ? Math.round((contributors[0]?.totalCommits / totalCommits) * 100)
        : 0;

    switch (riskLevel) {
      case 'CRITICAL':
        if (totalContributors <= 2) {
          return `Critical risk: Very few contributors (${totalContributors} total). Bus factor of ${busFactor}.`;
        } else if (busFactor === 1) {
          return `Critical risk: Bus factor of ${busFactor}. Top contributor has ${topContributorPercentage}% of commits - extreme concentration of knowledge.`;
        } else {
          return `Critical risk: Bus factor of ${busFactor}. Top contributor has ${topContributorPercentage}% of commits.`;
        }
      case 'HIGH':
        return `High risk: Bus factor of ${busFactor}. Top contributor has ${topContributorPercentage}% of commits - significant knowledge concentration.`;
      case 'MEDIUM':
        return `Medium risk: Bus factor of ${busFactor}. Top contributor has ${topContributorPercentage}% of commits - moderate knowledge concentration.`;
      case 'LOW':
        return `Low risk: Good contributor distribution with bus factor of ${busFactor}. Top contributor has ${topContributorPercentage}% of commits.`;
      default:
        return `Unknown risk level.`;
    }
  }

  private createEmptyResult(): BusFactorResult {
    return {
      busFactor: 0,
      totalContributors: 0,
      totalCommits: 0,
      topContributors: [],
      riskLevel: 'LOW',
      riskReason: 'No commits found for analysis.',
      analysisDate: new Date(),
    };
  }

  async storeBusFactorResults(
    watchlistId: string,
    results: BusFactorResult,
  ): Promise<void> {
    try {
      await this.prisma.busFactorData.create({
        data: {
          watchlist_id: watchlistId,
          bus_factor: results.busFactor,
          total_contributors: results.totalContributors,
          total_commits: results.totalCommits,
          top_contributors: results.topContributors as any,
          risk_level: results.riskLevel,
          risk_reason: results.riskReason,
          analysis_date: results.analysisDate,
        },
      });

      this.logger.log(
        `📊 Bus factor results stored for ${watchlistId}: ${results.busFactor} (${results.riskLevel})`,
      );
      this.logger.log(
        `   Top contributors: ${results.topContributors.map((c) => `${c.author} (${c.totalCommits} commits)`).join(', ')}`,
      );
    } catch (error) {
      this.logger.error(
        `❌ Failed to store bus factor results: ${error.message}`,
      );
      throw error;
    }
  }
}
