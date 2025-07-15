import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import { PrismaService } from '../../../common/prisma/prisma.service';

const execAsync = promisify(exec);

@Injectable()
export class GitManagerService {
  private readonly logger = new Logger(GitManagerService.name);
  private readonly baseDir: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    // Create a directory for cloned repositories
    this.baseDir = this.configService.get<string>('GIT_CLONE_DIR', './temp-repos');
    this.ensureBaseDir();
  }

  private ensureBaseDir() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
      this.logger.log(`Created git clone directory: ${this.baseDir}`);
    }
  }

  private getRepoPath(owner: string, repo: string): string {
    // Handle long filenames by truncating if necessary
    // Windows has a 260 character path limit, so we need to be careful
    const maxPathLength = 200; // Leave room for baseDir and file extensions
    const combinedName = `${owner}-${repo}`;
    
    if (combinedName.length > maxPathLength) {
      // Truncate the repo name if it's too long, but keep owner intact
      const maxRepoLength = maxPathLength - owner.length - 1; // -1 for the dash
      const truncatedRepo = repo.substring(0, maxRepoLength);
      return path.join(this.baseDir, `${owner}-${truncatedRepo}`);
    }
    
    return path.join(this.baseDir, combinedName);
  }

  async cloneRepository(owner: string, repo: string, branch: string = 'main'): Promise<string> {
    const repoPath = this.getRepoPath(owner, repo);
    const repoUrl = `https://github.com/${owner}/${repo}.git`;

    try {
      // Check if repository already exists
      if (fs.existsSync(repoPath)) {
        this.logger.log(`Repository ${owner}/${repo} already exists, fetching updates`);
        return await this.fetchRepository(owner, repo, branch);
      }

      this.logger.log(`Cloning repository ${owner}/${repo} to ${repoPath}`);

      // Clone the repository with options to avoid post-clone scripts
      const { stdout, stderr } = await execAsync(
        `git clone --branch ${branch} --single-branch --depth 1 --no-checkout --no-tags ${repoUrl} "${repoPath}"`,
        { timeout: 300000 } // 5 minute timeout
      );

      if (stderr && !stderr.includes('Cloning into')) {
        this.logger.warn(`Git clone stderr: ${stderr}`);
      }

      this.logger.log(`Successfully cloned ${owner}/${repo} to ${repoPath}`);
      return repoPath;

    } catch (error) {
      this.logger.error(`Error cloning repository ${owner}/${repo}:`, error);
      
      // Clean up partial clone if it exists
      if (fs.existsSync(repoPath)) {
        await this.cleanupRepository(owner, repo);
      }
      
      throw new Error(`Failed to clone repository ${owner}/${repo}: ${error.message}`);
    }
  }

  async fetchRepository(owner: string, repo: string, branch: string = 'main'): Promise<string> {
    const repoPath = this.getRepoPath(owner, repo);

    if (!fs.existsSync(repoPath)) {
      throw new Error(`Repository ${owner}/${repo} not found locally`);
    }

    try {
      this.logger.log(`Fetching updates for ${owner}/${repo}`);

      // Fetch latest changes
      await execAsync(`git fetch origin ${branch}`, { cwd: repoPath });
      
      // Reset to latest commit on the branch
      await execAsync(`git reset --hard origin/${branch}`, { cwd: repoPath });

      this.logger.log(`Successfully updated ${owner}/${repo}`);
      return repoPath;

    } catch (error) {
      this.logger.error(`Error fetching repository ${owner}/${repo}:`, error);
      throw new Error(`Failed to fetch repository ${owner}/${repo}: ${error.message}`);
    }
  }

  async cleanupRepository(owner: string, repo: string): Promise<void> {
    const repoPath = this.getRepoPath(owner, repo);

    if (!fs.existsSync(repoPath)) {
      return;
    }

    try {
      this.logger.log(`Cleaning up repository ${owner}/${repo}`);
      
      // On Windows, we need to handle file locking issues
      const isWindows = os.platform() === 'win32';
      
      if (isWindows) {
        // Use a more robust cleanup method for Windows
        try {
          // First try to remove with force
          fs.rmSync(repoPath, { recursive: true, force: true });
        } catch (windowsError: any) {
          if (windowsError.code === 'EBUSY' || windowsError.code === 'ENOTEMPTY') {
            this.logger.warn(`Windows file locking detected for ${owner}/${repo}, will retry cleanup later`);
            // Don't throw error, just log warning - the cleanup will happen on next run
            return;
          }
          throw windowsError;
        }
      } else {
        // Unix systems
        fs.rmSync(repoPath, { recursive: true, force: true });
      }
      
      this.logger.log(`Successfully cleaned up ${owner}/${repo}`);
    } catch (error) {
      this.logger.error(`Error cleaning up repository ${owner}/${repo}:`, error);
      // Don't throw error, just log it - cleanup is not critical
      this.logger.warn(`Repository cleanup failed for ${owner}/${repo}, will retry on next run`);
    }
  }

  /**
   * Backfill commits for a repository: shallow clone and log up to 1000 commits from the last year.
   */
  async backfillCommitsForRepo(owner: string, repo: string, branch: string = 'main', watchlistId?: string): Promise<void> {
    const repoPath = this.getRepoPath(owner, repo);
    const repoUrl = `https://github.com/${owner}/${repo}.git`;
    
    try {
      if (!fs.existsSync(repoPath)) {
        this.logger.log(`Backfill: Cloning ${owner}/${repo} with --depth=1000`);
        await execAsync(`git clone --branch ${branch} --single-branch --depth 1000 ${repoUrl} "${repoPath}"`, { timeout: 600000 });
      } else {
        this.logger.log(`Backfill: Repo ${owner}/${repo} already cloned, using existing directory.`);
      }
      
      const isWindows = os.platform() === 'win32';
      const sinceArg = isWindows ? `"1 year ago"` : `'1 year ago'`;
      const prettyArg = isWindows
        ? `"%H|%an|%ae|%ad|%s"`
        : "'%H|%an|%ae|%ad|%s'";
      
      const gitLogCmd = `git log --since=${sinceArg} --pretty=format:${prettyArg} -n 1000`;
      const { stdout } = await execAsync(gitLogCmd, { cwd: repoPath });
      
      const commits = stdout.split('\n').filter(Boolean).map(line => {
        const [sha, author, email, date, ...msgParts] = line.split('|');
        return { sha, author, email, date, message: msgParts.join('|') };
      });
      
      this.logger.log(`Backfill: Found ${commits.length} commits for ${owner}/${repo} (last 1 year, up to 1000).`);
      
      // For now, we'll just log the commits found
      // TODO: Implement proper logging to database when we have the log table schema
      this.logger.log(`Backfill: Processed ${commits.length} commits for ${owner}/${repo}`);
      
      // Clean up the cloned repo directory
      await this.cleanupRepository(owner, repo);
      this.logger.log(`🧹 Cleaned up temp repo for ${owner}/${repo}\n`);
      
    } catch (error) {
      this.logger.error(`Backfill error for ${owner}/${repo}:`, error);
      throw error;
    }
  }
} 