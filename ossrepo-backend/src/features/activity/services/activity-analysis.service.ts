import { Injectable, Logger } from '@nestjs/common';

export interface ActivityScore {
  score: number;
  level: 'LOW' | 'MODERATE' | 'HIGH' | 'VERY_HIGH';
  factors: {
    commitFrequency: number;
    contributorDiversity: number;
    codeChurn: number;
    developmentConsistency: number;
  };
}

export interface FileChurnData {
  filePath: string;
  commitCount: number;
  totalLinesAdded: number;
  totalLinesDeleted: number;
  netChange: number;
  lastModified: Date;
  churnRate: number;
}

export interface ActivityHeatmap {
  dayOfWeek: { [key: number]: number };
  hourOfDay: { [key: number]: number };
  dayHourMatrix: { [key: string]: number };
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

  calculateWeeklyCommitRate(commits: CommitData[]): number {
    if (commits.length === 0) return 0;

    const now = new Date();
    const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const recentCommits = commits.filter((c) => c.date >= threeMonthsAgo);

    if (recentCommits.length === 0) return 0;

    const weeksInPeriod = 12;
    const weeklyCommitRate = recentCommits.length / weeksInPeriod;

    return Math.round(weeklyCommitRate * 100) / 100;
  }

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

    const now = new Date();
    const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
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

    const recentCommitsPerMonth = recentCommits.length / 3;
    const commitFrequency = Math.min(recentCommitsPerMonth / 15, 1) * 25;

    const recentContributors = new Set(recentCommits.map((c) => c.author)).size;
    const contributorDiversity = Math.min(recentContributors / 5, 1) * 25;

    const totalLinesChanged = recentCommits.reduce(
      (sum, c) => sum + c.linesAdded + c.linesDeleted,
      0,
    );
    const avgLinesPerCommit = totalLinesChanged / recentCommits.length;
    const codeChurn = Math.min(avgLinesPerCommit / 50, 1) * 25;

    const weeklyCommitRate = this.calculateWeeklyCommitRate(recentCommits);
    const developmentConsistency = Math.min(weeklyCommitRate / 3, 1) * 25;

    const totalScore =
      commitFrequency +
      contributorDiversity +
      codeChurn +
      developmentConsistency;

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

    const dates = commits
      .map((c) => c.date)
      .sort((a, b) => a.getTime() - b.getTime());
    const timeSpan =
      (dates[dates.length - 1].getTime() - dates[0].getTime()) /
      (1000 * 60 * 60 * 24 * 30);

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

    return fileChurnData.sort((a, b) => b.commitCount - a.commitCount);
  }

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

    for (let day = 0; day < 7; day++) {
      dayOfWeek[day] = 0;
    }
    for (let hour = 0; hour < 24; hour++) {
      hourOfDay[hour] = 0;
    }

    for (const commit of commits) {
      const date = commit.date;
      const day = date.getDay();
      const hour = date.getHours();
      const dayHourKey = `${day}_${hour}`;

      dayOfWeek[day]++;
      hourOfDay[hour]++;
      dayHourMatrix[dayHourKey] = (dayHourMatrix[dayHourKey] || 0) + 1;
    }

    const dayMapping = { 0: 6, 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5 };
    const convertedDayOfWeek: { [key: number]: number } = {};
    for (let i = 0; i < 7; i++) {
      convertedDayOfWeek[dayMapping[i]] = dayOfWeek[i];
    }

    const convertedDayHourMatrix: { [key: string]: number } = {};
    for (const [key, count] of Object.entries(dayHourMatrix)) {
      const [day, hour] = key.split('_').map(Number);
      const convertedDay = dayMapping[day];
      const convertedKey = `${convertedDay}_${hour}`;
      convertedDayHourMatrix[convertedKey] = count;
    }

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

  getTopActiveFiles(
    fileChurnData: FileChurnData[],
    limit: number = 10,
  ): FileChurnData[] {
    return fileChurnData.slice(0, limit);
  }

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
