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
        return await this.fetchRepository(owner, repo, branch);
      }

      // Clone the repository with options to avoid post-clone scripts
      const { stdout, stderr } = await execAsync(
        `git clone --branch ${branch} --single-branch --depth 1 --no-checkout --no-tags ${repoUrl} "${repoPath}"`,
        { timeout: 300000 } // 5 minute timeout
      );

      if (stderr && !stderr.includes('Cloning into')) {
        this.logger.warn(`Git clone stderr: ${stderr}`);
      }

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
      // Fetch latest changes
      await execAsync(`git fetch origin ${branch}`, { cwd: repoPath });
      
      // Reset to latest commit on the branch
      await execAsync(`git reset --hard origin/${branch}`, { cwd: repoPath });

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
      // On Windows, we need to handle file locking issues
      const isWindows = os.platform() === 'win32';
      
      if (isWindows) {
        // Use a more robust cleanup method for Windows
        try {
          // First try to remove with force
          fs.rmSync(repoPath, { recursive: true, force: true });
        } catch (windowsError: any) {
          if (windowsError.code === 'EBUSY' || windowsError.code === 'ENOTEMPTY') {
            // Don't throw error, just log warning - the cleanup will happen on next run
            return;
          }
          throw windowsError;
        }
      } else {
        // Unix systems
        fs.rmSync(repoPath, { recursive: true, force: true });
      }
      
    } catch (error) {
      this.logger.error(`Error cleaning up repository ${owner}/${repo}:`, error);
      // Don't throw error, just log it - cleanup is not critical
    }
  }

  /**
   * Deepen a shallow repository iteratively to get more commits from the last 2 years
   */
  async deepenRepository(owner: string, repo: string, branch: string = 'main', targetCommits: number = 2000): Promise<number> {
    const repoPath = this.getRepoPath(owner, repo);
    
    if (!fs.existsSync(repoPath)) {
      throw new Error(`Repository ${owner}/${repo} not found locally`);
    }

    try {
      let currentDepth = 1;
      let commitCount = 0;
      const maxDepth = 2000; // Increased from 1000 to allow deeper history
      
      while (currentDepth <= maxDepth) {
        // Fetch more commits to increase depth
        await execAsync(`git fetch --depth=${currentDepth} origin ${branch}`, { cwd: repoPath });
        
        // Count commits in the last 2 years
        commitCount = await this.getCommitCountInLastTwoYears(owner, repo);
        
        // Check if we have enough commits or if we've reached the target
        if (commitCount >= targetCommits) {
          break;
        }
        
        // Check if we're getting diminishing returns (less than 10% increase)
        const nextDepth = Math.min(currentDepth * 2, maxDepth);
        if (nextDepth === currentDepth) {
          break;
        }
        
        // Double the depth for next iteration (exponential backoff)
        currentDepth = nextDepth;
      }
      
      return commitCount;
      
    } catch (error) {
      this.logger.error(`❌ Failed to deepen repository ${owner}/${repo}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get the number of commits in the last 2 years for a repository
   */
  private async getCommitCountInLastTwoYears(owner: string, repo: string): Promise<number> {
    const repoPath = this.getRepoPath(owner, repo);
    
    try {
      const isWindows = os.platform() === 'win32';
      const sinceArg = isWindows ? `"2 years ago"` : `'2 years ago'`;
      
      // Use git log with --format=oneline and count the lines
      const gitLogCmd = `git log --since=${sinceArg} --format=oneline`;
      const { stdout } = await execAsync(gitLogCmd, { cwd: repoPath });
      
      // Count non-empty lines
      const lines = stdout.split('\n').filter(line => line.trim().length > 0);
      return lines.length;
      
    } catch (error) {
      this.logger.error(`❌ Failed to count commits for ${owner}/${repo}: ${error.message}`);
      return 0;
    }
  }

  /**
   * Get commits for a repository (up to 2000 from the last 2 years)
   */
  private async getCommitsForRepo(owner: string, repo: string): Promise<any[]> {
    const repoPath = this.getRepoPath(owner, repo);
    
    try {
      const isWindows = os.platform() === 'win32';
      const sinceArg = isWindows ? `"2 years ago"` : `'2 years ago'`;
      const prettyArg = isWindows
        ? `"%H|%an|%ae|%ad|%s"`
        : "'%H|%an|%ae|%ad|%s'";
      
      const gitLogCmd = `git log --since=${sinceArg} --pretty=format:${prettyArg} -n 2000`;
      const { stdout } = await execAsync(gitLogCmd, { cwd: repoPath });
      
      return stdout.split('\n').filter(Boolean).map(line => {
        const [sha, author, email, date, ...msgParts] = line.split('|');
        return { sha, author, email, date, message: msgParts.join('|') };
      });
      
    } catch (error) {
      this.logger.error(`❌ Failed to get commits for ${owner}/${repo}: ${error.message}`);
      return [];
    }
  }

  /**
   * Backfill commits for a repository: deepen existing clone and log up to 2000 commits from the last 2 years.
   */
  async backfillCommitsForRepo(owner: string, repo: string, branch: string = 'main', watchlistId?: string): Promise<{ commitCount: number; commits: any[] }> {
    const repoPath = this.getRepoPath(owner, repo);
    
    try {
      // Ensure repository exists (should be cloned by cloneRepository)
      if (!fs.existsSync(repoPath)) {
        throw new Error(`Repository ${owner}/${repo} not found. Run cloneRepository first.`);
      }
      
      // Deepen the repository to get more commits
      const commitCount = await this.deepenRepository(owner, repo, branch, 2000);
      
      // Get the actual commits for processing
      const commits = await this.getCommitsForRepo(owner, repo);
      
      // For now, we'll just log the commits found
      // TODO: Implement proper logging to database when we have the log table schema
      
      return { commitCount, commits };
      
    } catch (error) {
      this.logger.error(`❌ Backfill failed for ${owner}/${repo}: ${error.message}`);
      throw error;
    }
  }
} 