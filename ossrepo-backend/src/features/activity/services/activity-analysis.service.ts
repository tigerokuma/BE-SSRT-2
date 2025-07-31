import { Injectable, Logger } from '@nestjs/common';

export interface ActivityScore {
  score: number; // 0-100
  level: 'LOW' | 'MODERATE' | 'HIGH' | 'VERY_HIGH';
  factors: {
    commitFrequency: number;      // Recent commit frequency (last 3 months)
    contributorDiversity: number; // Recent contributor diversity (last 3 months)
    codeChurn: number;           // Recent code churn (last 3 months)
    developmentConsistency: number; // Development consistency (weekly patterns)
  };
}

export interface FileChurnData {
  filePath: string;
  commitCount: number;
  totalLinesAdded: number;
  totalLinesDeleted: number;
  netChange: number;
  lastModified: Date;
  churnRate: number; // commits per month
}

export interface ActivityHeatmap {
  dayOfWeek: { [key: number]: number }; // 0-6 (Sunday-Saturday)
  hourOfDay: { [key: number]: number }; // 0-23
  dayHourMatrix: { [key: string]: number }; // "day_hour" format
  peakActivity: {
    day: string;
    hour: number;
    count: number;
  };
}

export interface CommitData {
  sha: string;
  author: string;
  email: string;
  date: Date;
  message: string;
  filesChanged: string[];
  linesAdded: number;
  linesDeleted: number;
}

@Injectable()
export class ActivityAnalysisService {
  private readonly logger = new Logger(ActivityAnalysisService.name);

  /**
   * Calculate weekly commit rate based on recent activity
   */
  calculateWeeklyCommitRate(commits: CommitData[]): number {
    if (commits.length === 0) return 0;

    // Focus on last 3 months for weekly rate calculation
    const now = new Date();
    const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const recentCommits = commits.filter((c) => c.date >= threeMonthsAgo);

    if (recentCommits.length === 0) return 0;

    // Calculate weeks in the 3-month period
    const weeksInPeriod = 12; // 3 months = ~12 weeks

    // Calculate average weekly commits
    const weeklyCommitRate = recentCommits.length / weeksInPeriod;

    return Math.round(weeklyCommitRate * 100) / 100; // Round to 2 decimal places
  }

  /**
   * Calculate overall repository activity score (0-100)
   */
  calculateActivityScore(commits: CommitData[]): ActivityScore {
    if (commits.length === 0) {
      return {
        score: 0,
        level: 'LOW',
        factors: {
          commitFrequency: 0,
          contributorDiversity: 0,
          codeChurn: 0,
          developmentConsistency: 0,
        },
      };
    }

    // Calculate time span
    const now = new Date();
    const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    
    // Filter commits to last 3 months only
    const recentCommits = commits.filter((c) => c.date >= threeMonthsAgo);
    
    if (recentCommits.length === 0) {
      return {
        score: 0,
        level: 'LOW',
        factors: {
          commitFrequency: 0,
          contributorDiversity: 0,
          codeChurn: 0,
          developmentConsistency: 0,
        },
      };
    }

    // Factor 1: Recent Commit Frequency (0-25 points) - Focus on last 3 months
    const recentCommitsPerMonth = recentCommits.length / 3; // 3 months
    const commitFrequency = Math.min(recentCommitsPerMonth / 15, 1) * 25; // 15 commits/month in last 3 months = max score

    // Factor 2: Recent Contributor Diversity (0-25 points) - Focus on last 3 months
    const recentContributors = new Set(recentCommits.map((c) => c.author)).size;
    const contributorDiversity = Math.min(recentContributors / 5, 1) * 25; // 5+ contributors in last 3 months = max score

    // Factor 3: Recent Code Churn (0-25 points) - Focus on last 3 months
    const totalLinesChanged = recentCommits.reduce(
      (sum, c) => sum + c.linesAdded + c.linesDeleted,
      0,
    );
    const avgLinesPerCommit = totalLinesChanged / recentCommits.length;
    const codeChurn = Math.min(avgLinesPerCommit / 50, 1) * 25; // 50+ lines/commit in last 3 months = max score

    // Factor 4: Development Consistency (0-25 points) - Weekly patterns
    const weeklyCommitRate = this.calculateWeeklyCommitRate(recentCommits);
    const developmentConsistency = Math.min(weeklyCommitRate / 3, 1) * 25; // 3+ commits/week = max score

    const totalScore =
      commitFrequency + contributorDiversity + codeChurn + developmentConsistency;

    let level: ActivityScore['level'];
    if (totalScore >= 80) level = 'VERY_HIGH';
    else if (totalScore >= 60) level = 'HIGH';
    else if (totalScore >= 40) level = 'MODERATE';
    else level = 'LOW';

    return {
      score: Math.round(totalScore),
      level,
      factors: {
        commitFrequency: Math.round(commitFrequency),
        contributorDiversity: Math.round(contributorDiversity),
        codeChurn: Math.round(codeChurn),
        developmentConsistency: Math.round(developmentConsistency),
      },
    };
  }

  /**
   * Analyze file churn patterns
   */
  analyzeFileChurn(commits: CommitData[]): FileChurnData[] {
    if (commits.length === 0) return [];

    const fileStats = new Map<
      string,
      {
        commitCount: number;
        totalLinesAdded: number;
        totalLinesDeleted: number;
        lastModified: Date;
      }
    >();

    // Aggregate file statistics
    for (const commit of commits) {
      for (const file of commit.filesChanged) {
        const existing = fileStats.get(file) || {
          commitCount: 0,
          totalLinesAdded: 0,
          totalLinesDeleted: 0,
          lastModified: new Date(0),
        };

        existing.commitCount++;
        existing.totalLinesAdded += commit.linesAdded;
        existing.totalLinesDeleted += commit.linesDeleted;

        if (commit.date > existing.lastModified) {
          existing.lastModified = commit.date;
        }

        fileStats.set(file, existing);
      }
    }

    // Calculate time span for churn rate
    const dates = commits
      .map((c) => c.date)
      .sort((a, b) => a.getTime() - b.getTime());
    const timeSpan =
      (dates[dates.length - 1].getTime() - dates[0].getTime()) /
      (1000 * 60 * 60 * 24 * 30); // months

    // Convert to array and calculate additional metrics
    const fileChurnData: FileChurnData[] = Array.from(fileStats.entries()).map(
      ([filePath, stats]) => ({
        filePath,
        commitCount: stats.commitCount,
        totalLinesAdded: stats.totalLinesAdded,
        totalLinesDeleted: stats.totalLinesDeleted,
        netChange: stats.totalLinesAdded - stats.totalLinesDeleted,
        lastModified: stats.lastModified,
        churnRate: stats.commitCount / Math.max(timeSpan, 1),
      }),
    );

    // Sort by commit count (most active files first)
    return fileChurnData.sort((a, b) => b.commitCount - a.commitCount);
  }

  /**
   * Generate activity heatmap data
   */
  generateActivityHeatmap(commits: CommitData[]): ActivityHeatmap {
    if (commits.length === 0) {
      return {
        dayOfWeek: {},
        hourOfDay: {},
        dayHourMatrix: {},
        peakActivity: { day: 'Monday', hour: 0, count: 0 },
      };
    }

    const dayOfWeek: { [key: number]: number } = {};
    const hourOfDay: { [key: number]: number } = {};
    const dayHourMatrix: { [key: string]: number } = {};

    // Initialize counters
    for (let day = 0; day < 7; day++) {
      dayOfWeek[day] = 0;
    }
    for (let hour = 0; hour < 24; hour++) {
      hourOfDay[hour] = 0;
    }

    // Count commits by time
    for (const commit of commits) {
      const date = commit.date;
      const day = date.getDay();
      const hour = date.getHours();
      const dayHourKey = `${day}_${hour}`;

      dayOfWeek[day]++;
      hourOfDay[hour]++;
      dayHourMatrix[dayHourKey] = (dayHourMatrix[dayHourKey] || 0) + 1;
    }

    // Convert day mapping: 0=Sunday becomes 6, 1=Monday becomes 0, etc.
    const dayMapping = { 0: 6, 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5 };
    const convertedDayOfWeek: { [key: number]: number } = {};
    for (let i = 0; i < 7; i++) {
      convertedDayOfWeek[dayMapping[i]] = dayOfWeek[i];
    }

    // Convert dayHourMatrix to use Monday-first mapping
    const convertedDayHourMatrix: { [key: string]: number } = {};
    for (const [key, count] of Object.entries(dayHourMatrix)) {
      const [day, hour] = key.split('_').map(Number);
      const convertedDay = dayMapping[day];
      const convertedKey = `${convertedDay}_${hour}`;
      convertedDayHourMatrix[convertedKey] = count;
    }

    // Find peak activity using converted dayHourMatrix
    let peakCount = 0;
    let peakDay = 0;
    let peakHour = 0;

    for (const [key, count] of Object.entries(convertedDayHourMatrix)) {
      if (count > peakCount) {
        peakCount = count;
        const [day, hour] = key.split('_').map(Number);
        peakDay = day;
        peakHour = hour;
      }
    }

    const dayNames = [
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ];

    return {
      dayOfWeek: convertedDayOfWeek,
      hourOfDay,
      dayHourMatrix: convertedDayHourMatrix,
      peakActivity: {
        day: dayNames[dayMapping[peakDay]],
        hour: peakHour,
        count: peakCount,
      },
    };
  }

  /**
   * Get top N most active files
   */
  getTopActiveFiles(
    fileChurnData: FileChurnData[],
    limit: number = 10,
  ): FileChurnData[] {
    return fileChurnData.slice(0, limit);
  }

  /**
   * Get activity summary for logging
   */
  getActivitySummary(
    activityScore: ActivityScore,
    fileChurnData: FileChurnData[],
    heatmap: ActivityHeatmap,
    weeklyCommitRate: number,
  ): string {
    return (
      `Activity Score: ${activityScore.score}/100 (${activityScore.level}) | ` +
      `Weekly Commit Rate: ${weeklyCommitRate.toFixed(2)} commits/week | ` +
      `Peak Activity: ${heatmap.peakActivity.day} ${heatmap.peakActivity.hour}:00 (${heatmap.peakActivity.count} commits)`
    );
  }
}
