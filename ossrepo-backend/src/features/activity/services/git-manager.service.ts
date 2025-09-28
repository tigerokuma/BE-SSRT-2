import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { createHash } from 'crypto';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

@Injectable()
export class GitManagerService {
  private readonly logger = new Logger(GitManagerService.name);
  private readonly baseDir: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.baseDir = this.configService.get<string>(
      'GIT_CLONE_DIR',
      './temp-repos',
    );
    this.ensureBaseDir();
  }

  private ensureBaseDir() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
      this.logger.log(`Created git clone directory: ${this.baseDir}`);
    }
  }

  private getRepoPath(owner: string, repo: string): string {
    const maxPathLength = 200;
    const combinedName = `${owner}-${repo}`;

    if (combinedName.length > maxPathLength) {
      const maxRepoLength = maxPathLength - owner.length - 1;
      const truncatedRepo = repo.substring(0, maxRepoLength);
      return path.join(this.baseDir, `${owner}-${truncatedRepo}`);
    }

    return path.join(this.baseDir, combinedName);
  }

  async cloneRepository(
    owner: string,
    repo: string,
    branch: string = 'main',
    depth: number = 1,
  ): Promise<string> {
    const repoPath = this.getRepoPath(owner, repo);
    const repoUrl = `https://github.com/${owner}/${repo}.git`;

    try {
      if (fs.existsSync(repoPath)) {
        return await this.fetchRepository(owner, repo, branch);
      }

      const { stdout, stderr } = await execAsync(
        `git clone --branch ${branch} --single-branch --depth ${depth} --no-checkout --no-tags ${repoUrl} "${repoPath}"`,
        { timeout: 300000 },
      );

      if (stderr && !stderr.includes('Cloning into')) {
        this.logger.warn(`Git clone stderr: ${stderr}`);
      }

      return repoPath;
    } catch (error) {
      this.logger.error(`Error cloning repository ${owner}/${repo}:`, error);

      if (fs.existsSync(repoPath)) {
        await this.cleanupRepository(owner, repo);
      }

      throw new Error(
        `Failed to clone repository ${owner}/${repo}: ${error.message}`,
      );
    }
  }

  async fetchRepository(
    owner: string,
    repo: string,
    branch: string = 'main',
  ): Promise<string> {
    const repoPath = this.getRepoPath(owner, repo);

    if (!fs.existsSync(repoPath)) {
      throw new Error(`Repository ${owner}/${repo} not found locally`);
    }

    try {
      await execAsync(`git fetch origin ${branch}`, { cwd: repoPath });
      await execAsync(`git reset --hard origin/${branch}`, { cwd: repoPath });

      return repoPath;
    } catch (error) {
      this.logger.error(`Error fetching repository ${owner}/${repo}:`, error);
      throw new Error(
        `Failed to fetch repository ${owner}/${repo}: ${error.message}`,
      );
    }
  }

  async cleanupRepository(owner: string, repo: string): Promise<void> {
    const repoPath = this.getRepoPath(owner, repo);

    if (!fs.existsSync(repoPath)) {
      return;
    }

    try {
      const isWindows = os.platform() === 'win32';

      if (isWindows) {
        try {
          fs.rmSync(repoPath, { recursive: true, force: true });
        } catch (windowsError: any) {
          if (
            windowsError.code === 'EBUSY' ||
            windowsError.code === 'ENOTEMPTY'
          ) {
            return;
          }
          throw windowsError;
        }
      } else {
        fs.rmSync(repoPath, { recursive: true, force: true });
      }
    } catch (error) {
      this.logger.error(
        `Error cleaning up repository ${owner}/${repo}:`,
        error,
      );
    }
  }

  async deepenRepository(
    owner: string,
    repo: string,
    branch: string = 'main',
    targetCommits: number = 2000,
  ): Promise<number> {
    const repoPath = this.getRepoPath(owner, repo);

    if (!fs.existsSync(repoPath)) {
      throw new Error(`Repository ${owner}/${repo} not found locally`);
    }

    try {
      let currentDepth = 1;
      let commitCount = 0;
      const maxDepth = 2000;
      const maxTimeMinutes = 10;
      const startTime = Date.now();

      while (currentDepth <= maxDepth) {
        if (Date.now() - startTime > maxTimeMinutes * 60 * 1000) {
          this.logger.warn(
            `⏰ Time limit reached while deepening ${owner}/${repo}. Using current depth: ${currentDepth}`,
          );
          break;
        }

        await execAsync(`git fetch --depth=${currentDepth} origin ${branch}`, {
          cwd: repoPath,
        });

        commitCount = await this.getCommitCountInLastTwoYears(owner, repo);

        if (commitCount >= targetCommits) {
          break;
        }

        const nextDepth = Math.min(currentDepth * 2, maxDepth);
        if (nextDepth === currentDepth) {
          break;
        }

        currentDepth = nextDepth;
      }

      return commitCount;
    } catch (error) {
      this.logger.error(
        `❌ Failed to deepen repository ${owner}/${repo}: ${error.message}`,
      );
      throw error;
    }
  }

  private async getCommitCountInLastTwoYears(
    owner: string,
    repo: string,
  ): Promise<number> {
    const repoPath = this.getRepoPath(owner, repo);

    try {
      const isWindows = os.platform() === 'win32';
      const sinceArg = isWindows ? `"2 years ago"` : `'2 years ago'`;

      const gitLogCmd = `git log --since=${sinceArg} --format=oneline`;
      const { stdout } = await execAsync(gitLogCmd, { cwd: repoPath });

      const lines = stdout.split('\n').filter((line) => line.trim().length > 0);
      return lines.length;
    } catch (error) {
      this.logger.error(
        `❌ Failed to count commits for ${owner}/${repo}: ${error.message}`,
      );
      return 0;
    }
  }

  private async getCommitsForRepo(owner: string, repo: string): Promise<any[]> {
    const repoPath = this.getRepoPath(owner, repo);
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['log', '--pretty=format:%H|%an|%ae|%aI|%s', '-n', '2000'],
        { cwd: repoPath, timeout: 300000 },
      );

      const commits = stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [sha, author, email, date, ...msgParts] = line.split('|');
          return { sha, author, email, date, message: msgParts.join('|') };
        });

      const commitsWithStats: any[] = [];
      const maxCommitsToProcess = 2000;
      const commitsToProcess = commits.slice(0, maxCommitsToProcess);

      if (commits.length > maxCommitsToProcess) {
        this.logger.warn(
          `📊 Large repository detected: ${owner}/${repo} has ${commits.length} commits. Processing first ${maxCommitsToProcess} commits.`,
        );
      }

      for (const commit of commitsToProcess) {
        try {
          const { stdout: showOut } = await execFileAsync(
            'git',
            ['show', '--numstat', '--pretty=format:""', commit.sha],
            { cwd: repoPath, timeout: 60000 },
          );

          const fileStats = showOut
            .split('\n')
            .filter((line) => line.trim() && /\d+\s+\d+\s+.+/.test(line))
            .map((line) => {
              const [added, deleted, filename] = line.split(/\s+/);
              return {
                filename,
                lines_added: parseInt(added, 10),
                lines_deleted: parseInt(deleted, 10),
              };
            });

          const files_changed = fileStats.map((f) => f.filename);
          const lines_added = fileStats.reduce(
            (sum, f) => sum + (f.lines_added || 0),
            0,
          );
          const lines_deleted = fileStats.reduce(
            (sum, f) => sum + (f.lines_deleted || 0),
            0,
          );

          commitsWithStats.push({
            ...commit,
            files_changed,
            lines_added,
            lines_deleted,
          });
        } catch (error) {
          this.logger.warn(
            `Failed to get stats for commit ${commit.sha}: ${error.message}`,
          );
          commitsWithStats.push({
            ...commit,
            files_changed: [],
            lines_added: 0,
            lines_deleted: 0,
          });
        }
      }

      return commitsWithStats;
    } catch (error) {
      this.logger.error(
        `❌ Failed to get commits for ${owner}/${repo}: ${error.message}`,
      );
      return [];
    }
  }

  private async logCommitsToDatabase(
    watchlistId: string,
    commits: any[],
  ): Promise<void> {
    this.logger.log(
      `Logging ${commits.length} new commits for watchlist ID: ${watchlistId}`,
    );
    if (!watchlistId) {
      this.logger.error(`Invalid watchlist ID: ${watchlistId}`);
      throw new Error(`Invalid watchlist ID: ${watchlistId}`);
    }
    try {
      const lastLog = await this.prisma.log.findFirst({
        where: { watchlist_id: watchlistId },
        orderBy: { timestamp: 'desc' },
      });

      let currentPrevHash = lastLog ? lastLog.event_hash : null;
      let processedCount = 0;
      let skippedCount = 0;
      const batchSize = 1000;

      for (let i = 0; i < commits.length; i += batchSize) {
        const batch = commits.slice(i, i + batchSize);

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

        const newCommits = batch.filter(
          (commit) => !existingEventIds.has(`commit_${commit.sha}`),
        );

        if (newCommits.length === 0) {
          skippedCount += batch.length;
          continue;
        }

        // Process commits in reasonable batches to avoid connection pool issues
        const commitBatchSize = 50; // Process 50 commits at a time - good balance between speed and connection pool
        const commitBatches: any[][] = [];
        for (let i = 0; i < newCommits.length; i += commitBatchSize) {
          commitBatches.push(newCommits.slice(i, i + commitBatchSize));
        }

        for (const commitBatch of commitBatches) {
          const batchPromises = commitBatch.map(async (commit) => {
            let commitDate: Date;
            try {
              commitDate = new Date(commit.date);
              if (isNaN(commitDate.getTime())) {
                this.logger.warn(
                  `Invalid date for commit ${commit.sha}: "${commit.date}", using current date`,
                );
                commitDate = new Date();
              }
            } catch (error) {
              this.logger.warn(
                `Error parsing date for commit ${commit.sha}: "${commit.date}", using current date`,
              );
              commitDate = new Date();
            }

            const payload = {
              sha: commit.sha,
              message: commit.message,
              email: commit.email,
              files_changed: commit.files_changed || [],
              lines_added: commit.lines_added || 0,
              lines_deleted: commit.lines_deleted || 0,
            };

            const logData = {
              watchlist_id: watchlistId,
              event_type: 'COMMIT',
              actor: commit.author,
              timestamp: commitDate,
              payload,
              prev_event_hash: currentPrevHash,
            };

            const eventHash = this.createEventHash(logData);

            // Retry logic for Prisma connection pool issues
            let retryCount = 0;
            const maxRetries = 3;
            while (retryCount < maxRetries) {
              try {
                await this.prisma.log.create({
                  data: {
                    event_id: `commit_${commit.sha}`,
                    event_type: 'COMMIT',
                    actor: commit.author,
                    timestamp: commitDate,
                    payload,
                    event_hash: eventHash,
                    prev_event_hash: currentPrevHash,
                    watchlist_id: watchlistId,
                  },
                });
                break; // Success, exit retry loop
              } catch (error: any) {
                retryCount++;
                if (error.message?.includes('connection pool') && retryCount < maxRetries) {
                  this.logger.warn(`Prisma connection pool timeout, retrying ${retryCount}/${maxRetries}...`);
                  await new Promise(resolve => setTimeout(resolve, 1000 * retryCount)); // Exponential backoff
                } else {
                  throw error; // Re-throw if not a connection pool error or max retries reached
                }
              }
            }

            currentPrevHash = eventHash;
            processedCount++;
          });

          // Wait for this batch to complete before starting the next batch
          await Promise.all(batchPromises);
        }
        skippedCount += batch.length - newCommits.length;
      }

      this.logger.log(
        `✅ Commit logging completed: ${processedCount} processed, ${skippedCount} skipped`,
      );
    } catch (error) {
      this.logger.error(
        `Error logging new commits for watchlist ID ${watchlistId}:`,
        error,
      );
      throw error;
    }
  }

  private createEventHash(logData: any): string {
    const hash = createHash('sha256');
    hash.update(JSON.stringify(logData));
    return hash.digest('hex');
  }

  async backfillCommitsForRepo(
    owner: string,
    repo: string,
    branch: string = 'main',
    watchlistId?: string,
  ): Promise<{ commitCount: number; commits: any[] }> {
    const repoPath = this.getRepoPath(owner, repo);

    try {
      if (!fs.existsSync(repoPath)) {
        throw new Error(
          `Repository ${owner}/${repo} not found. Run cloneRepository first.`,
        );
      }

      await this.deepenRepository(owner, repo, branch, 2000);

      const commits = await this.getCommitsForRepo(owner, repo);

      if (watchlistId) {
        await this.logCommitsToDatabase(watchlistId, commits);
      }

      return { commitCount: commits.length, commits };
    } catch (error) {
      this.logger.error(
        `❌ Backfill failed for ${owner}/${repo}: ${error.message}`,
      );
      throw error;
    }
  }

  async updateContributorStats(watchlistId: string): Promise<void> {
    try {
      this.logger.log(
        `📊 Updating contributor stats for watchlist ${watchlistId}`,
      );

      const logs = await this.prisma.log.findMany({
        where: { watchlist_id: watchlistId, event_type: 'COMMIT' },
        select: { actor: true, timestamp: true, payload: true },
      });

      if (logs.length === 0) {
        this.logger.warn(`No commits found for watchlist ${watchlistId}`);
        return;
      }

      const statsByEmail: Record<string, any[]> = {};
      for (const log of logs) {
        const email = (log.payload as any)?.email;
        if (!email) continue;
        if (!statsByEmail[email]) statsByEmail[email] = [];
        statsByEmail[email].push(log);
      }

      for (const [email, entries] of Object.entries(statsByEmail)) {
        const author_name = entries[0].actor;
        const total_commits = entries.length;

        if (total_commits === 0) continue;

        const lines_added_arr = entries.map((e) => e.payload?.lines_added || 0);
        const lines_deleted_arr = entries.map(
          (e) => e.payload?.lines_deleted || 0,
        );
        const files_changed_arr = entries.map(
          (e) => e.payload?.files_changed?.length || 0,
        );

        const avg_lines_added =
          lines_added_arr.reduce((a, b) => a + b, 0) / total_commits;
        const avg_lines_deleted =
          lines_deleted_arr.reduce((a, b) => a + b, 0) / total_commits;
        const avg_files_changed =
          files_changed_arr.reduce((a, b) => a + b, 0) / total_commits;

        const stddev = (arr: number[], avg: number) =>
          Math.sqrt(
            arr.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / arr.length,
          );
        const stddev_lines_added = stddev(lines_added_arr, avg_lines_added);
        const stddev_lines_deleted = stddev(
          lines_deleted_arr,
          avg_lines_deleted,
        );
        const stddev_files_changed = stddev(
          files_changed_arr,
          avg_files_changed,
        );

        const commit_time_histogram: Record<string, number> = {};
        for (const e of entries) {
          const hour = new Date(e.timestamp).getHours();
          commit_time_histogram[hour.toString()] =
            (commit_time_histogram[hour.toString()] || 0) + 1;
        }

        const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const dayCounts: Record<string, number> = {};
        for (const e of entries) {
          const day = daysOfWeek[new Date(e.timestamp).getDay()];
          dayCounts[day] = (dayCounts[day] || 0) + 1;
        }
        const maxDayCount = Math.max(...Object.values(dayCounts));
        const threshold = maxDayCount * 0.35;
        const typical_days_active = Object.entries(dayCounts)
          .filter(([_, count]) => count >= threshold)
          .map(([day]) => day);

        const last_commit_date = new Date(
          Math.max(...entries.map((e) => new Date(e.timestamp).getTime())),
        );

        await this.prisma.contributorStats.upsert({
          where: {
            watchlist_id_author_email: {
              watchlist_id: watchlistId,
              author_email: email,
            },
          },
          update: {
            author_name,
            total_commits,
            avg_lines_added,
            avg_lines_deleted,
            avg_files_changed,
            commit_time_histogram,
            last_commit_date,
            stddev_lines_added,
            stddev_lines_deleted,
            stddev_files_changed,
            typical_days_active,
          },
          create: {
            watchlist_id: watchlistId,
            author_email: email,
            author_name,
            total_commits,
            avg_lines_added,
            avg_lines_deleted,
            avg_files_changed,
            commit_time_histogram,
            last_commit_date,
            stddev_lines_added,
            stddev_lines_deleted,
            stddev_files_changed,
            typical_days_active,
          },
        });
      }

      this.logger.log(
        `✅ Contributor stats updated for watchlist ${watchlistId}`,
      );

      await this.updateRepoStats(watchlistId);
    } catch (err) {
      this.logger.error(
        `Error updating contributor stats for watchlist ${watchlistId}:`,
        err,
      );
      throw err;
    }
  }

  private async updateRepoStats(watchlistId: string): Promise<void> {
    try {
      const logs = await this.prisma.log.findMany({
        where: { watchlist_id: watchlistId, event_type: 'COMMIT' },
        select: { timestamp: true, payload: true },
      });

      if (logs.length === 0) return;

      const linesAddedArr = logs.map(
        (log) => (log.payload as any)?.lines_added || 0,
      );
      const linesDeletedArr = logs.map(
        (log) => (log.payload as any)?.lines_deleted || 0,
      );
      const filesChangedArr = logs.map(
        (log) => (log.payload as any)?.files_changed?.length || 0,
      );

      const avgLinesAdded =
        linesAddedArr.reduce((sum, val) => sum + val, 0) / logs.length;
      const avgLinesDeleted =
        linesDeletedArr.reduce((sum, val) => sum + val, 0) / logs.length;
      const avgFilesChanged =
        filesChangedArr.reduce((sum, val) => sum + val, 0) / logs.length;

      const stddev = (arr: number[], avg: number) =>
        Math.sqrt(
          arr.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / arr.length,
        );

      const stddevLinesAdded = stddev(linesAddedArr, avgLinesAdded);
      const stddevLinesDeleted = stddev(linesDeletedArr, avgLinesDeleted);
      const stddevFilesChanged = stddev(filesChangedArr, avgFilesChanged);

      const commitTimeHistogram: Record<string, number> = {};
      for (const log of logs) {
        const hour = new Date(log.timestamp).getHours();
        commitTimeHistogram[hour.toString()] =
          (commitTimeHistogram[hour.toString()] || 0) + 1;
      }

      const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const dayCounts: Record<string, number> = {};
      for (const log of logs) {
        const day = daysOfWeek[new Date(log.timestamp).getDay()];
        dayCounts[day] = (dayCounts[day] || 0) + 1;
      }

      await this.prisma.repoStats.upsert({
        where: { watchlist_id: watchlistId },
        update: {
          total_commits: logs.length,
          avg_lines_added: avgLinesAdded,
          avg_lines_deleted: avgLinesDeleted,
          avg_files_changed: avgFilesChanged,
          stddev_lines_added: stddevLinesAdded,
          stddev_lines_deleted: stddevLinesDeleted,
          stddev_files_changed: stddevFilesChanged,
          commit_time_histogram: commitTimeHistogram,
          typical_days_active: dayCounts,
          last_updated: new Date(),
        },
        create: {
          watchlist_id: watchlistId,
          total_commits: logs.length,
          avg_lines_added: avgLinesAdded,
          avg_lines_deleted: avgLinesDeleted,
          avg_files_changed: avgFilesChanged,
          stddev_lines_added: stddevLinesAdded,
          stddev_lines_deleted: stddevLinesDeleted,
          stddev_files_changed: stddevFilesChanged,
          commit_time_histogram: commitTimeHistogram,
          typical_days_active: dayCounts,
        },
      });

      this.logger.log(`📊 Repo stats updated for watchlist ${watchlistId}`);
    } catch (error) {
      this.logger.error(
        `Error updating repo stats for watchlist ${watchlistId}:`,
        error,
      );
      throw error;
    }
  }

  async ensureStatsExist(watchlistId: string): Promise<void> {
    try {
      this.logger.log(
        `🔍 Checking if stats exist for watchlist ${watchlistId}`,
      );

      const existingRepoStats = await this.prisma.repoStats.findUnique({
        where: { watchlist_id: watchlistId },
      });

      const existingContributorStats =
        await this.prisma.contributorStats.findFirst({
          where: { watchlist_id: watchlistId },
        });

      if (!existingRepoStats || !existingContributorStats) {
        this.logger.log(
          `📊 Stats missing for watchlist ${watchlistId}, calculating...`,
        );
        await this.updateContributorStats(watchlistId);
        this.logger.log(
          `✅ Stats calculation completed for watchlist ${watchlistId}`,
        );
      } else {
        this.logger.log(`✅ Stats already exist for watchlist ${watchlistId}`);
      }
    } catch (error) {
      this.logger.error(
        `Error ensuring stats exist for watchlist ${watchlistId}:`,
        error,
      );
      throw error;
    }
  }
}
