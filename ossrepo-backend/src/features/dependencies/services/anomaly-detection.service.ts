import { Injectable, Logger } from '@nestjs/common';
import { CommitDetails } from './git-commit-extractor.service';

interface AnomalyScoreResult {
  totalScore: number;
  breakdown: Array<{
    factor: string;
    points: number;
    reason: string;
  }>;
}

interface ContributorProfile {
  avg_files_changed: number;
  stddev_files_changed: number;
  avg_lines_added: number;
  stddev_lines_added: number;
  avg_lines_deleted: number;
  stddev_lines_deleted: number;
  avg_commit_message_length: number;
  stddev_commit_message_length: number;
  insert_to_delete_ratio: number;
  commit_time_histogram: any;
  typical_days_active: any;
  files_worked_on: any;
}

@Injectable()
export class AnomalyDetectionService {
  private readonly logger = new Logger(AnomalyDetectionService.name);

  /**
   * Calculate anomaly score for a commit against contributor baseline
   */
  calculateAnomalyScore(
    commit: CommitDetails,
    contributorProfile: ContributorProfile,
  ): AnomalyScoreResult {
    const breakdown: Array<{ factor: string; points: number; reason: string }> = [];

    // Check each anomaly type
    const filesChangedResult = this.checkFilesChangedAnomaly(commit, contributorProfile);
    if (filesChangedResult.points > 0) breakdown.push(filesChangedResult);

    const linesChangedResult = this.checkLinesChangedAnomaly(commit, contributorProfile);
    if (linesChangedResult.points > 0) breakdown.push(linesChangedResult);

    const messageLengthResult = this.checkMessageLengthAnomaly(commit, contributorProfile);
    if (messageLengthResult.points > 0) breakdown.push(messageLengthResult);

    const insertDeleteRatioResult = this.checkInsertDeleteRatioAnomaly(commit, contributorProfile);
    if (insertDeleteRatioResult.points > 0) breakdown.push(insertDeleteRatioResult);

    const timeAnomalyResult = this.checkTimeAnomaly(commit, contributorProfile);
    if (timeAnomalyResult.points > 0) breakdown.push(timeAnomalyResult);

    const dayAnomalyResult = this.checkDayAnomaly(commit, contributorProfile);
    if (dayAnomalyResult.points > 0) breakdown.push(dayAnomalyResult);

    const newFilesResult = this.checkNewFilesAnomaly(commit, contributorProfile);
    if (newFilesResult.points > 0) breakdown.push(newFilesResult);

    const totalScore = breakdown.reduce((sum, item) => sum + item.points, 0);

    return {
      totalScore,
      breakdown,
    };
  }

  /**
   * Check files changed anomaly
   */
  private checkFilesChangedAnomaly(
    commit: CommitDetails,
    profile: ContributorProfile,
  ): { factor: string; points: number; reason: string } {
    const avg = profile.avg_files_changed;
    const stddev = profile.stddev_files_changed;

    if (stddev === 0) {
      return { factor: 'files_changed', points: 0, reason: '' };
    }

    const deviation = (commit.filesChanged - avg) / stddev;

    if (deviation >= 3) {
      return {
        factor: 'files_changed',
        points: 15,
        reason: `Unusually high number of files changed (${commit.filesChanged} files vs avg ${avg.toFixed(1)}, ${deviation.toFixed(1)} std dev above mean)`,
      };
    } else if (deviation >= 2) {
      return {
        factor: 'files_changed',
        points: 10,
        reason: `Unusually high number of files changed (${commit.filesChanged} files vs avg ${avg.toFixed(1)}, ${deviation.toFixed(1)} std dev above mean)`,
      };
    }

    return { factor: 'files_changed', points: 0, reason: '' };
  }

  /**
   * Check lines changed anomaly
   */
  private checkLinesChangedAnomaly(
    commit: CommitDetails,
    profile: ContributorProfile,
  ): { factor: string; points: number; reason: string } {
    const totalLines = commit.linesAdded + commit.linesDeleted;
    const avgTotal = profile.avg_lines_added + profile.avg_lines_deleted;
    const stddevTotal = Math.sqrt(
      Math.pow(profile.stddev_lines_added, 2) + Math.pow(profile.stddev_lines_deleted, 2),
    );

    if (stddevTotal === 0) {
      return { factor: 'lines_changed', points: 0, reason: '' };
    }

    const deviation = (totalLines - avgTotal) / stddevTotal;

    if (deviation >= 3) {
      return {
        factor: 'lines_changed',
        points: 15,
        reason: `Unusually high number of lines changed (${totalLines} lines vs avg ${avgTotal.toFixed(1)}, ${deviation.toFixed(1)} std dev above mean)`,
      };
    } else if (deviation >= 2) {
      return {
        factor: 'lines_changed',
        points: 10,
        reason: `Unusually high number of lines changed (${totalLines} lines vs avg ${avgTotal.toFixed(1)}, ${deviation.toFixed(1)} std dev above mean)`,
      };
    }

    return { factor: 'lines_changed', points: 0, reason: '' };
  }

  /**
   * Check commit message length anomaly
   */
  private checkMessageLengthAnomaly(
    commit: CommitDetails,
    profile: ContributorProfile,
  ): { factor: string; points: number; reason: string } {
    const messageLength = commit.message.length;
    const avg = profile.avg_commit_message_length;
    const stddev = profile.stddev_commit_message_length;

    if (stddev === 0) {
      return { factor: 'message_length', points: 0, reason: '' };
    }

    const deviation = Math.abs(messageLength - avg) / stddev;

    if (deviation >= 2) {
      if (messageLength > avg) {
        return {
          factor: 'message_length',
          points: 5,
          reason: `Unusually long commit message (${messageLength} chars vs avg ${avg.toFixed(1)}, ${deviation.toFixed(1)} std dev above mean)`,
        };
      } else {
        return {
          factor: 'message_length',
          points: 5,
          reason: `Unusually short commit message (${messageLength} chars vs avg ${avg.toFixed(1)}, ${deviation.toFixed(1)} std dev below mean)`,
        };
      }
    }

    return { factor: 'message_length', points: 0, reason: '' };
  }

  /**
   * Check insert-to-delete ratio anomaly
   */
  private checkInsertDeleteRatioAnomaly(
    commit: CommitDetails,
    profile: ContributorProfile,
  ): { factor: string; points: number; reason: string } {
    if (commit.linesDeleted === 0) {
      return { factor: 'insert_delete_ratio', points: 0, reason: '' };
    }

    const commitRatio = commit.linesAdded / commit.linesDeleted;
    const profileRatio = profile.insert_to_delete_ratio;

    if (profileRatio === 0 || profileRatio === 999) {
      return { factor: 'insert_delete_ratio', points: 0, reason: '' };
    }

    // Calculate percentage difference
    const percentDiff = Math.abs((commitRatio - profileRatio) / profileRatio) * 100;

    if (percentDiff > 50) {
      return {
        factor: 'insert_delete_ratio',
        points: 5,
        reason: `Unusual insert-to-delete ratio (${commitRatio.toFixed(2)} vs typical ${profileRatio.toFixed(2)}, ${percentDiff.toFixed(1)}% difference)`,
      };
    }

    return { factor: 'insert_delete_ratio', points: 0, reason: '' };
  }

  /**
   * Check abnormal time anomaly
   */
  private checkTimeAnomaly(
    commit: CommitDetails,
    profile: ContributorProfile,
  ): { factor: string; points: number; reason: string } {
    const hour = commit.timestamp.getHours();
    const hourKey = `${hour}:00`;
    const histogram = profile.commit_time_histogram;

    if (!histogram || typeof histogram !== 'object') {
      return { factor: 'abnormal_time', points: 0, reason: '' };
    }

    // Calculate total commits across all hours
    const totalCommits: number = Object.values(histogram).reduce(
      (sum: number, count: any) => sum + (typeof count === 'number' ? count : 0),
      0,
    ) as number;

    if (totalCommits === 0) {
      return { factor: 'abnormal_time', points: 0, reason: '' };
    }

    // Get commits at this hour
    const commitsAtThisHour = typeof histogram[hourKey] === 'number' ? (histogram[hourKey] as number) : 0;
    const percentage = (commitsAtThisHour / totalCommits) * 100;

    if (percentage < 5) {
      return {
        factor: 'abnormal_time',
        points: 5,
        reason: `Unusual time for contributor to commit (${hour}:00, only ${percentage.toFixed(1)}% of commits at this hour)`,
      };
    }

    return { factor: 'abnormal_time', points: 0, reason: '' };
  }

  /**
   * Check abnormal day anomaly
   */
  private checkDayAnomaly(
    commit: CommitDetails,
    profile: ContributorProfile,
  ): { factor: string; points: number; reason: string } {
    const dayOfWeek = commit.timestamp.getDay();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayName = dayNames[dayOfWeek];
    const typicalDays = profile.typical_days_active;

    if (!typicalDays || typeof typicalDays !== 'object') {
      return { factor: 'abnormal_day', points: 0, reason: '' };
    }

    // Calculate total commits across all days
    const totalCommits: number = Object.values(typicalDays).reduce(
      (sum: number, count: any) => sum + (typeof count === 'number' ? count : 0),
      0,
    ) as number;

    if (totalCommits === 0) {
      return { factor: 'abnormal_day', points: 0, reason: '' };
    }

    // Get commits on this day
    const commitsOnThisDay = typeof typicalDays[dayName] === 'number' ? (typicalDays[dayName] as number) : 0;
    const percentage = (commitsOnThisDay / totalCommits) * 100;

    if (percentage < 10) {
      return {
        factor: 'abnormal_day',
        points: 5,
        reason: `Unusual day for contributor to commit (${dayName}, only ${percentage.toFixed(1)}% of commits on this day)`,
      };
    }

    return { factor: 'abnormal_day', points: 0, reason: '' };
  }

  /**
   * Check new files anomaly
   */
  private checkNewFilesAnomaly(
    commit: CommitDetails,
    profile: ContributorProfile,
  ): { factor: string; points: number; reason: string } {
    if (!commit.diffData || !commit.diffData.filesChanged || !Array.isArray(commit.diffData.filesChanged)) {
      return { factor: 'new_files', points: 0, reason: '' };
    }

    const filesWorkedOn = profile.files_worked_on;
    if (!filesWorkedOn || typeof filesWorkedOn !== 'object') {
      return { factor: 'new_files', points: 0, reason: '' };
    }

    const newFiles: string[] = [];
    for (const file of commit.diffData.filesChanged) {
      if (!filesWorkedOn[file] || filesWorkedOn[file] === 0) {
        newFiles.push(file);
      }
    }

    if (newFiles.length === 0) {
      return { factor: 'new_files', points: 0, reason: '' };
    }

    // Cap at 3 files (max 30 points)
    const filesToCount = newFiles.slice(0, 3);
    const points = filesToCount.length * 10;
    const fileList = filesToCount.map(f => f.split('/').pop()).join(', ');

    return {
      factor: 'new_files',
      points,
      reason: `Working on ${filesToCount.length} new file(s) not in contributor's history: ${fileList}`,
    };
  }
}
