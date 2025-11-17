import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CommitDetails } from './git-commit-extractor.service';

@Injectable()
export class ContributorProfileUpdaterService {
  private readonly logger = new Logger(ContributorProfileUpdaterService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Update contributor profiles with new commits (incremental update)
   */
  async updateContributorProfiles(packageId: string, newCommits: CommitDetails[]): Promise<void> {
    this.logger.log(`🔄 Updating contributor profiles for package ${packageId} with ${newCommits.length} new commits`);

    // Group commits by author email
    const commitsByAuthor = new Map<string, CommitDetails[]>();
    for (const commit of newCommits) {
      const email = commit.authorEmail;
      if (!commitsByAuthor.has(email)) {
        commitsByAuthor.set(email, []);
      }
      commitsByAuthor.get(email)!.push(commit);
    }

    // Update each contributor's profile
    for (const [authorEmail, commits] of commitsByAuthor) {
      try {
        await this.updateContributorProfile(packageId, authorEmail, commits);
      } catch (error) {
        this.logger.error(`❌ Failed to update contributor ${authorEmail}:`, error);
        // Continue with other contributors
      }
    }

    this.logger.log(`✅ Updated ${commitsByAuthor.size} contributor profiles`);
  }

  /**
   * Update a single contributor's profile with new commits
   */
  private async updateContributorProfile(
    packageId: string,
    authorEmail: string,
    newCommits: CommitDetails[]
  ): Promise<void> {
    // Get or create contributor profile
    let profile = await this.getOrCreateContributor(packageId, authorEmail, newCommits[0]);

    // Extract data from new commits
    const newLinesAdded = newCommits.map(c => c.linesAdded);
    const newLinesDeleted = newCommits.map(c => c.linesDeleted);
    const newFilesChanged = newCommits.map(c => c.filesChanged);
    const newTimestamps = newCommits.map(c => c.timestamp);
    const newMessageLengths = newCommits.map(c => c.message.length);

    // Calculate new totals
    const newTotalCommits = profile.total_commits + newCommits.length;
    const newTotalLinesAdded = this.calculateNewTotal(profile.avg_lines_added, profile.total_commits, newLinesAdded);
    const newTotalLinesDeleted = this.calculateNewTotal(profile.avg_lines_deleted, profile.total_commits, newLinesDeleted);
    const newTotalFilesChanged = this.calculateNewTotal(profile.avg_files_changed, profile.total_commits, newFilesChanged);
    const newTotalMessageLength = this.calculateNewTotal(profile.avg_commit_message_length, profile.total_commits, newMessageLengths);

    // Calculate new averages
    const newAvgLinesAdded = newTotalLinesAdded / newTotalCommits;
    const newAvgLinesDeleted = newTotalLinesDeleted / newTotalCommits;
    const newAvgFilesChanged = newTotalFilesChanged / newTotalCommits;
    const newAvgMessageLength = newTotalMessageLength / newTotalCommits;

    // Calculate new standard deviations using incremental formula
    const newStddevLinesAdded = this.calculateIncrementalStandardDeviation(
      profile.stddev_lines_added,
      profile.avg_lines_added,
      profile.total_commits,
      newLinesAdded,
      newAvgLinesAdded,
      newTotalCommits
    );
    const newStddevLinesDeleted = this.calculateIncrementalStandardDeviation(
      profile.stddev_lines_deleted,
      profile.avg_lines_deleted,
      profile.total_commits,
      newLinesDeleted,
      newAvgLinesDeleted,
      newTotalCommits
    );
    const newStddevFilesChanged = this.calculateIncrementalStandardDeviation(
      profile.stddev_files_changed,
      profile.avg_files_changed,
      profile.total_commits,
      newFilesChanged,
      newAvgFilesChanged,
      newTotalCommits
    );
    const newStddevMessageLength = this.calculateIncrementalStandardDeviation(
      profile.stddev_commit_message_length,
      profile.avg_commit_message_length,
      profile.total_commits,
      newMessageLengths,
      newAvgMessageLength,
      newTotalCommits
    );

    // Update histograms
    const updatedCommitTimeHistogram = this.updateCommitTimeHistogram(
      profile.commit_time_histogram as any,
      newTimestamps
    );
    const updatedTypicalDaysActive = this.updateTypicalDaysActive(
      profile.typical_days_active as any,
      newTimestamps
    );
    const updatedCommitTimeHeatmap = this.updateCommitTimeHeatmap(
      profile.commit_time_heatmap as any,
      newTimestamps
    );

    // Update files worked on
    const updatedFilesWorkedOn = this.updateFilesWorkedOn(
      profile.files_worked_on as any,
      newCommits
    );

    // Calculate new insert-to-delete ratio using the new totals
    const newInsertToDeleteRatio = newTotalLinesDeleted === 0 ? 999 : newTotalLinesAdded / newTotalLinesDeleted;

    // Update first and last commit dates
    const newFirstCommitDate = new Date(Math.min(
      profile.first_commit_date.getTime(),
      ...newTimestamps.map(t => t.getTime())
    ));
    const newLastCommitDate = new Date(Math.max(
      profile.last_commit_date.getTime(),
      ...newTimestamps.map(t => t.getTime())
    ));

    // Update the profile in database
    await this.prisma.packageContributor.update({
      where: {
        package_id_author_email: {
          package_id: packageId,
          author_email: authorEmail,
        },
      },
      data: {
        total_commits: newTotalCommits,
        avg_lines_added: newAvgLinesAdded,
        avg_lines_deleted: newAvgLinesDeleted,
        avg_files_changed: newAvgFilesChanged,
        avg_commit_message_length: newAvgMessageLength,
        stddev_lines_added: newStddevLinesAdded,
        stddev_lines_deleted: newStddevLinesDeleted,
        stddev_files_changed: newStddevFilesChanged,
        stddev_commit_message_length: newStddevMessageLength,
        insert_to_delete_ratio: newInsertToDeleteRatio,
        commit_time_histogram: updatedCommitTimeHistogram,
        typical_days_active: updatedTypicalDaysActive,
        commit_time_heatmap: updatedCommitTimeHeatmap,
        files_worked_on: updatedFilesWorkedOn,
        first_commit_date: newFirstCommitDate,
        last_commit_date: newLastCommitDate,
        updated_at: new Date(),
      },
    });

    this.logger.log(`✅ Updated profile for ${authorEmail}: ${newCommits.length} new commits`);
  }

  /**
   * Get existing contributor or create new one
   */
  private async getOrCreateContributor(
    packageId: string,
    authorEmail: string,
    firstCommit: CommitDetails
  ): Promise<any> {
    let profile = await this.prisma.packageContributor.findUnique({
      where: {
        package_id_author_email: {
          package_id: packageId,
          author_email: authorEmail,
        },
      },
    });

    if (!profile) {
      // Create new contributor profile
      profile = await this.prisma.packageContributor.create({
        data: {
          package_id: packageId,
          author_email: authorEmail,
          author_name: firstCommit.author,
          total_commits: 0,
          avg_lines_added: 0,
          avg_lines_deleted: 0,
          avg_files_changed: 0,
          avg_commit_message_length: 0,
          stddev_lines_added: 0,
          stddev_lines_deleted: 0,
          stddev_files_changed: 0,
          stddev_commit_message_length: 0,
          insert_to_delete_ratio: 0,
          commit_time_histogram: {},
          typical_days_active: {},
          commit_time_heatmap: this.createEmptyHeatmap(),
          files_worked_on: {},
          first_commit_date: firstCommit.timestamp,
          last_commit_date: firstCommit.timestamp,
        },
      });
    }

    return profile;
  }

  /**
   * Calculate new total from existing average and new values
   */
  private calculateNewTotal(existingAvg: number, existingCount: number, newValues: number[]): number {
    const existingTotal = existingAvg * existingCount;
    const newTotal = newValues.reduce((a, b) => a + b, 0);
    return existingTotal + newTotal;
  }

  /**
   * Calculate standard deviation incrementally using the old std dev, old avg, old count,
   * new data, new avg, and new count. This avoids needing to store all raw data points.
   * 
   * Formula: σ_new = sqrt(((n1-1)*σ1² + n2*σ2² + n1*n2*(μ1-μ2)²/(n1+n2)) / (n1+n2-1))
   * Where:
   * - n1 = old count, σ1 = old std dev, μ1 = old avg
   * - n2 = new count, σ2 = new std dev, μ2 = new avg
   */
  private calculateIncrementalStandardDeviation(
    oldStdDev: number,
    oldAvg: number,
    oldCount: number,
    newValues: number[],
    newAvg: number,
    newCount: number
  ): number {
    if (oldCount === 0) {
      // If no previous data, calculate std dev from new values only
      return this.calculateStandardDeviation(newValues);
    }

    if (newValues.length === 0) {
      // If no new data, return old std dev
      return oldStdDev;
    }

    // Calculate variance of new values
    const newVariance = this.calculateVariance(newValues, newAvg);
    
    // Calculate the combined variance using the incremental formula
    const n1 = oldCount;
    const n2 = newValues.length;
    const σ1_squared = oldStdDev * oldStdDev;
    const σ2_squared = newVariance;
    const μ1 = oldAvg;
    const μ2 = newAvg;

    // Combined variance formula
    const combinedVariance = (
      ((n1 - 1) * σ1_squared) +
      (n2 * σ2_squared) +
      (n1 * n2 * Math.pow(μ1 - μ2, 2)) / (n1 + n2)
    ) / (n1 + n2 - 1);

    return Math.sqrt(Math.max(0, combinedVariance));
  }

  /**
   * Calculate variance of a dataset given the mean
   */
  private calculateVariance(values: number[], mean: number): number {
    if (values.length === 0) return 0;
    const sumSquaredDiffs = values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0);
    return sumSquaredDiffs / values.length;
  }

  /**
   * Update commit time histogram with new timestamps
   */
  private updateCommitTimeHistogram(existingHistogram: any, newTimestamps: Date[]): any {
    const histogram = { ...existingHistogram };
    
    for (const timestamp of newTimestamps) {
      const hour = timestamp.getHours();
      const key = `${hour}:00`;
      histogram[key] = (histogram[key] || 0) + 1;
    }
    
    return histogram;
  }

  /**
   * Update typical days active with new timestamps
   */
  private updateTypicalDaysActive(existingDaysActive: any, newTimestamps: Date[]): any {
    const daysActive = { ...existingDaysActive };
    
    for (const timestamp of newTimestamps) {
      const dayOfWeek = timestamp.getDay();
      const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek];
      daysActive[dayName] = (daysActive[dayName] || 0) + 1;
    }
    
    return daysActive;
  }

  /**
   * Create empty 7x24 heatmap (7 days, 24 hours)
   */
  private createEmptyHeatmap(): number[][] {
    return Array(7).fill(null).map(() => Array(24).fill(0));
  }

  /**
   * Update commit time heatmap (7x24 grid) with new timestamps
   * Format: [day][hour] where day is 0-6 (Sunday-Saturday) and hour is 0-23
   */
  private updateCommitTimeHeatmap(existingHeatmap: number[][] | null, newTimestamps: Date[]): number[][] {
    // Initialize heatmap if it doesn't exist or is invalid
    let heatmap: number[][];
    if (!existingHeatmap || !Array.isArray(existingHeatmap) || existingHeatmap.length !== 7) {
      heatmap = this.createEmptyHeatmap();
    } else {
      // Deep copy the existing heatmap
      heatmap = existingHeatmap.map(day => [...day]);
    }

    // Update heatmap with new timestamps
    for (const timestamp of newTimestamps) {
      const dayOfWeek = timestamp.getDay(); // 0 = Sunday, 6 = Saturday
      const hour = timestamp.getHours(); // 0-23
      
      if (dayOfWeek >= 0 && dayOfWeek < 7 && hour >= 0 && hour < 24) {
        heatmap[dayOfWeek][hour] = (heatmap[dayOfWeek][hour] || 0) + 1;
      }
    }
    
    return heatmap;
  }

  /**
   * Update files worked on with new commits
   */
  private updateFilesWorkedOn(existingFilesWorkedOn: any, newCommits: CommitDetails[]): any {
    const filesWorkedOn = { ...existingFilesWorkedOn };
    
    for (const commit of newCommits) {
      if (commit.diffData && commit.diffData.filesChanged) {
        for (const file of commit.diffData.filesChanged) {
          filesWorkedOn[file] = (filesWorkedOn[file] || 0) + 1;
        }
      }
    }
    
    return filesWorkedOn;
  }

  /**
   * Calculate standard deviation
   */
  private calculateStandardDeviation(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }
}
