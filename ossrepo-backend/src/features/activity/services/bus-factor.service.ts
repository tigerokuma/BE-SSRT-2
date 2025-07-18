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
  contributionSpan: number; // days
  averageLinesPerCommit: number;
  averageFilesPerCommit: number;
}

export interface BusFactorResult {
  busFactor: number;
  totalContributors: number;
  topContributors: ContributorStats[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  riskReason: string;
  analysisDate: Date;
}

@Injectable()
export class BusFactorService {
  private readonly logger = new Logger(BusFactorService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calculate bus factor for a repository based on commit data
   */
  async calculateBusFactor(watchlistId: string): Promise<BusFactorResult> {
    this.logger.log(`📊 Calculating bus factor for watchlist: ${watchlistId}`);

    try {
      // Get all commits for this repository
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

      if (commits.length === 0) {
        return this.createEmptyResult();
      }

      // Group commits by contributor
      const contributorStats = this.analyzeContributors(commits);
      const totalContributors = contributorStats.length;

      if (totalContributors === 0) {
        return this.createEmptyResult();
      }

      // Sort contributors by total commits (descending)
      const sortedContributors = contributorStats.sort((a, b) => b.totalCommits - a.totalCommits);

      // Calculate bus factor
      const busFactor = this.calculateBusFactorScore(sortedContributors);

      // Determine risk level
      const riskLevel = this.determineRiskLevel(busFactor, totalContributors, sortedContributors);

      // Get top contributors (up to 5)
      const topContributors = sortedContributors.slice(0, 5);

      const result: BusFactorResult = {
        busFactor,
        totalContributors,
        topContributors,
        riskLevel,
        riskReason: this.getRiskReason(riskLevel, busFactor, totalContributors, sortedContributors),
        analysisDate: new Date(),
      };

      this.logger.log(`✅ Bus factor calculated: ${busFactor} (${riskLevel} risk) - ${totalContributors} contributors`);

      return result;
    } catch (error) {
      this.logger.error(`❌ Error calculating bus factor for ${watchlistId}:`, error.message);
      return this.createEmptyResult();
    }
  }

  /**
   * Analyze commits to extract contributor statistics
   */
  private analyzeContributors(commits: any[]): ContributorStats[] {
    const contributorMap = new Map<string, ContributorStats>();

    for (const commit of commits) {
      const author = commit.actor;
      const payload = commit.payload as any;
      const timestamp = new Date(commit.timestamp);

      if (!contributorMap.has(author)) {
        contributorMap.set(author, {
          author,
          email: payload.author_email || '',
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
      stats.totalLinesAdded += payload.lines_added || 0;
      stats.totalLinesDeleted += payload.lines_deleted || 0;
      stats.totalFilesChanged += payload.files_changed?.length || 0;

      // Update first and last commit dates
      if (timestamp < stats.firstCommit) {
        stats.firstCommit = timestamp;
      }
      if (timestamp > stats.lastCommit) {
        stats.lastCommit = timestamp;
      }
    }

    // Calculate derived metrics
    for (const stats of contributorMap.values()) {
      stats.contributionSpan = Math.ceil(
        (stats.lastCommit.getTime() - stats.firstCommit.getTime()) / (1000 * 60 * 60 * 24)
      );
      stats.averageLinesPerCommit = stats.totalCommits > 0 
        ? Math.round((stats.totalLinesAdded + stats.totalLinesDeleted) / stats.totalCommits)
        : 0;
      stats.averageFilesPerCommit = stats.totalCommits > 0 
        ? Math.round(stats.totalFilesChanged / stats.totalCommits)
        : 0;
    }

    return Array.from(contributorMap.values());
  }

  /**
   * Calculate bus factor score based on contributor concentration
   */
  private calculateBusFactorScore(contributors: ContributorStats[]): number {
    if (contributors.length === 0) return 0;
    if (contributors.length === 1) return 1;

    const totalCommits = contributors.reduce((sum, c) => sum + c.totalCommits, 0);
    if (totalCommits === 0) return 0;

    // Calculate how many contributors we need to reach 50% of total commits
    let cumulativeCommits = 0;
    let contributorsNeeded = 0;

    for (const contributor of contributors) {
      cumulativeCommits += contributor.totalCommits;
      contributorsNeeded++;
      
      if (cumulativeCommits >= totalCommits * 0.5) {
        break;
      }
    }

    return contributorsNeeded;
  }

  /**
   * Determine risk level based on bus factor and contributor patterns
   */
  private determineRiskLevel(
    busFactor: number, 
    totalContributors: number, 
    contributors: ContributorStats[]
  ): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
    
    // Critical: Only 1-2 contributors total, or bus factor of 1
    if (totalContributors <= 2 || busFactor === 1) {
      return 'CRITICAL';
    }

    // High: Bus factor of 2-3, or single contributor has >70% of commits
    if (busFactor <= 3 || (contributors[0]?.totalCommits / contributors.reduce((sum, c) => sum + c.totalCommits, 0)) > 0.7) {
      return 'HIGH';
    }

    // Medium: Bus factor of 4-6, or top contributor has >50% of commits
    if (busFactor <= 6 || (contributors[0]?.totalCommits / contributors.reduce((sum, c) => sum + c.totalCommits, 0)) > 0.5) {
      return 'MEDIUM';
    }

    // Low: Good distribution of contributors
    return 'LOW';
  }

  /**
   * Generate human-readable risk reason
   */
  private getRiskReason(
    riskLevel: string, 
    busFactor: number, 
    totalContributors: number, 
    contributors: ContributorStats[]
  ): string {
    const totalCommits = contributors.reduce((sum, c) => sum + c.totalCommits, 0);
    const topContributorPercentage = totalCommits > 0 
      ? Math.round((contributors[0]?.totalCommits / totalCommits) * 100)
      : 0;

    switch (riskLevel) {
      case 'CRITICAL':
        return `Critical risk: Only ${totalContributors} contributor(s) total. Bus factor of ${busFactor}.`;
      case 'HIGH':
        return `High risk: Bus factor of ${busFactor}. Top contributor has ${topContributorPercentage}% of commits.`;
      case 'MEDIUM':
        return `Medium risk: Bus factor of ${busFactor}. Top contributor has ${topContributorPercentage}% of commits.`;
      case 'LOW':
        return `Low risk: Good contributor distribution with bus factor of ${busFactor}.`;
      default:
        return `Unknown risk level.`;
    }
  }

  /**
   * Create empty result for repositories with no commits
   */
  private createEmptyResult(): BusFactorResult {
    return {
      busFactor: 0,
      totalContributors: 0,
      topContributors: [],
      riskLevel: 'LOW',
      riskReason: 'No commits found for analysis.',
      analysisDate: new Date(),
    };
  }

  /**
   * Store bus factor results in database
   */
  async storeBusFactorResults(watchlistId: string, results: BusFactorResult): Promise<void> {
    try {
      // For now, we'll just log the results
      // TODO: Implement proper storage when we have the bus factor table schema
      this.logger.log(`📊 Bus factor results for ${watchlistId}: ${results.busFactor} (${results.riskLevel})`);
      this.logger.log(`   Top contributors: ${results.topContributors.map(c => `${c.author} (${c.totalCommits} commits)`).join(', ')}`);
    } catch (error) {
      this.logger.error(`❌ Failed to store bus factor results: ${error.message}`);
      throw error;
    }
  }
} 