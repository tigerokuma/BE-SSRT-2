import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';

export interface MonthlyCommitData {
  year: number;
  month: number;
  commitCount: number;
}

@Injectable()
export class MonthlyCommitsService {
  private readonly logger = new Logger(MonthlyCommitsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Aggregate commits by month for the last year
   */
  async aggregateMonthlyCommits(packageId: string, commits: any[]): Promise<void> {
    try {
      this.logger.log(`📊 Aggregating monthly commits for package: ${packageId}`);

      // Get the last 12 months from the most recent commit
      const now = new Date();
      const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1);
      
      // Filter commits from the last year
      const recentCommits = commits.filter(commit => 
        commit.timestamp && new Date(commit.timestamp) >= oneYearAgo
      );

      this.logger.log(`📅 Processing ${recentCommits.length} commits from the last year`);

      // Group commits by year and month
      const monthlyData = new Map<string, number>();

      for (const commit of recentCommits) {
        const commitDate = new Date(commit.timestamp);
        const year = commitDate.getFullYear();
        const month = commitDate.getMonth() + 1; // JavaScript months are 0-based, we want 1-based
        
        const key = `${year}-${month}`;
        monthlyData.set(key, (monthlyData.get(key) || 0) + 1);
      }

      // Store monthly data in database
      for (const [key, commitCount] of monthlyData) {
        const [yearStr, monthStr] = key.split('-');
        const year = parseInt(yearStr, 10);
        const month = parseInt(monthStr, 10);

        await this.prisma.packageMonthlyCommits.upsert({
          where: {
            package_id_year_month: {
              package_id: packageId,
              year: year,
              month: month
            }
          },
          update: {
            commit_count: commitCount,
            updated_at: new Date()
          },
          create: {
            package_id: packageId,
            year: year,
            month: month,
            commit_count: commitCount
          }
        });

        this.logger.log(`💾 Stored ${commitCount} commits for ${year}-${month.toString().padStart(2, '0')}`);
      }

      // Fill in missing months with 0 commits for the last 12 months
      await this.fillMissingMonths(packageId, oneYearAgo, now);

      this.logger.log(`✅ Completed monthly commit aggregation for package: ${packageId}`);
    } catch (error) {
      this.logger.error(`❌ Failed to aggregate monthly commits for package ${packageId}:`, error);
      throw error;
    }
  }

  /**
   * Fill in missing months with 0 commits for a complete 12-month view
   */
  private async fillMissingMonths(packageId: string, startDate: Date, endDate: Date): Promise<void> {
    try {
      const currentDate = new Date(startDate);
      
      while (currentDate <= endDate) {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth() + 1;

        // Check if this month already exists
        const existing = await this.prisma.packageMonthlyCommits.findUnique({
          where: {
            package_id_year_month: {
              package_id: packageId,
              year: year,
              month: month
            }
          }
        });

        // If it doesn't exist, create it with 0 commits
        if (!existing) {
          await this.prisma.packageMonthlyCommits.create({
            data: {
              package_id: packageId,
              year: year,
              month: month,
              commit_count: 0
            }
          });

          this.logger.log(`📅 Created empty month record for ${year}-${month.toString().padStart(2, '0')}`);
        }

        // Move to next month
        currentDate.setMonth(currentDate.getMonth() + 1);
      }
    } catch (error) {
      this.logger.error(`❌ Failed to fill missing months:`, error);
      // Don't throw - this is not critical
    }
  }

  /**
   * Get monthly commit data for a package
   */
  async getMonthlyCommits(packageId: string, months: number = 12): Promise<MonthlyCommitData[]> {
    try {
      const now = new Date();
      const startDate = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);

      const monthlyCommits = await this.prisma.packageMonthlyCommits.findMany({
        where: {
          package_id: packageId,
          OR: [
            {
              year: { gt: startDate.getFullYear() }
            },
            {
              year: startDate.getFullYear(),
              month: { gte: startDate.getMonth() + 1 }
            }
          ]
        },
        orderBy: [
          { year: 'asc' },
          { month: 'asc' }
        ]
      });

      return monthlyCommits.map(record => ({
        year: record.year,
        month: record.month,
        commitCount: record.commit_count
      }));
    } catch (error) {
      this.logger.error(`❌ Failed to get monthly commits for package ${packageId}:`, error);
      return [];
    }
  }

  /**
   * Calculate activity score based on monthly commit data
   */
  async calculateActivityScore(packageId: string): Promise<number> {
    try {
      const monthlyData = await this.getMonthlyCommits(packageId, 12);
      
      if (monthlyData.length === 0) {
        return 0;
      }

      // Calculate average commits per month
      const totalCommits = monthlyData.reduce((sum, month) => sum + month.commitCount, 0);
      const avgCommitsPerMonth = totalCommits / monthlyData.length;

      // Calculate activity score (0-100)
      // Scale: 0-5 commits/month = 0-50 points, 5+ commits/month = 50-100 points
      let activityScore = 0;
      
      if (avgCommitsPerMonth <= 5) {
        activityScore = (avgCommitsPerMonth / 5) * 50;
      } else {
        activityScore = 50 + Math.min((avgCommitsPerMonth - 5) / 10, 1) * 50;
      }

      // Cap at 100
      activityScore = Math.min(activityScore, 100);

      this.logger.log(`📊 Calculated activity score for package ${packageId}: ${activityScore.toFixed(2)} (avg: ${avgCommitsPerMonth.toFixed(2)} commits/month)`);
      
      return Math.round(activityScore);
    } catch (error) {
      this.logger.error(`❌ Failed to calculate activity score for package ${packageId}:`, error);
      return 0;
    }
  }

  /**
   * Get commit trend data for the chart
   */
  async getCommitTrendData(packageId: string, months: number = 12): Promise<{ date: string; score: number }[]> {
    try {
      const monthlyData = await this.getMonthlyCommits(packageId, months);
      
      return monthlyData.map(month => ({
        date: `${month.year}-${month.month.toString().padStart(2, '0')}-01`,
        score: month.commitCount
      }));
    } catch (error) {
      this.logger.error(`❌ Failed to get commit trend data for package ${packageId}:`, error);
      return [];
    }
  }
}
