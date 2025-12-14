import { Injectable, Logger } from '@nestjs/common';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface CommitDetails {
  sha: string;
  author: string;
  authorEmail: string;
  message: string;
  timestamp: Date;
  linesAdded: number;
  linesDeleted: number;
  filesChanged: number;
  diffData?: any;
}

@Injectable()
export class GitCommitExtractorService {
  private readonly logger = new Logger(GitCommitExtractorService.name);

  /**
   * Extract commits from a cloned repository with full metadata
   */
  async extractCommitsFromRepo(
    repoPath: string,
    maxCommits: number = 5000,
  ): Promise<CommitDetails[]> {
    try {
      this.logger.log(`🔍 Extracting up to ${maxCommits} commits from ${repoPath}`);

      // Use git log with detailed format to get all commit information
      const gitLogCmd = `git log --pretty=format:"%H|%an|%ae|%ad|%s" --numstat --max-count=${maxCommits} --date=iso`;
      
      const { stdout, stderr } = await execAsync(gitLogCmd, {
        cwd: repoPath,
        timeout: 300000, // 5 minutes timeout
        maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large repositories
      });

      if (stderr && !stderr.includes('warning')) {
        this.logger.warn(`Git log stderr: ${stderr}`);
      }

      const commits = this.parseGitLogOutput(stdout);
      
      // NOTE: We no longer extract diff data for all commits here.
      // Diff data extraction for 5000 commits takes too long (30s per commit = 41+ hours!)
      // If diff data is needed, call extractCommitDiff separately for specific commits.
      
      return commits;
    } catch (error) {
      this.logger.error(`❌ Failed to extract commits from ${repoPath}:`, error);
      throw new Error(`Failed to extract commits: ${error.message}`);
    }
  }

  /**
   * Extract diff data for a specific commit
   * Call this separately for commits that need detailed diff information
   */
  async extractCommitDiff(repoPath: string, commitSha: string): Promise<any> {
    try {
      // Get the diff for this commit
      const { stdout } = await execAsync(`git show --stat ${commitSha}`, {
        cwd: repoPath,
        timeout: 30000, // 30 seconds timeout per commit
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer per commit (for large diffs)
      });

      // Parse the diff output to extract file changes
      const lines = stdout.split('\n');
      const filesChanged: string[] = [];
      const diffStats = {
        filesChanged: 0,
        insertions: 0,
        deletions: 0,
        files: [] as Array<{ name: string; insertions: number; deletions: number }>
      };

      for (const line of lines) {
        // Look for file change lines (e.g., "src/file.js | 5 +++++")
        const fileMatch = line.match(/^(.+?)\s+\|\s+(\d+)\s+([+-]+)$/);
        if (fileMatch) {
          const [, fileName, changes, symbols] = fileMatch;
          const insertions = (symbols.match(/\+/g) || []).length;
          const deletions = (symbols.match(/-/g) || []).length;
          
          filesChanged.push(fileName.trim());
          diffStats.files.push({
            name: fileName.trim(),
            insertions,
            deletions
          });
          diffStats.insertions += insertions;
          diffStats.deletions += deletions;
        }
      }

      diffStats.filesChanged = filesChanged.length;

      return {
        filesChanged,
        stats: diffStats,
        rawDiff: stdout.substring(0, 1000) // Limit raw diff to first 1000 chars
      };
    } catch (error) {
      this.logger.warn(`⚠️ Failed to extract diff for commit ${commitSha}: ${error.message}`);
      return null;
    }
  }

  /**
   * Parse git log output into structured commit data
   */
  private parseGitLogOutput(output: string): CommitDetails[] {
    const commits: CommitDetails[] = [];
    const lines = output.trim().split('\n');
    
    let currentCommit: Partial<CommitDetails> | null = null;
    let currentStats: { added: number; deleted: number; files: number } = { added: 0, deleted: 0, files: 0 };

    for (const line of lines) {
      const trimmedLine = line.trim();
      
      if (!trimmedLine) continue;

      // Check if this is a commit header line (contains |)
      if (trimmedLine.includes('|')) {
        // Save previous commit if exists
        if (currentCommit && currentCommit.sha) {
          commits.push({
            ...currentCommit,
            linesAdded: currentStats.added,
            linesDeleted: currentStats.deleted,
            filesChanged: currentStats.files,
          } as CommitDetails);
        }

        // Parse new commit header
        const parts = trimmedLine.split('|');
        if (parts.length >= 5) {
          const [sha, author, authorEmail, dateStr, ...messageParts] = parts;
          const message = messageParts.join('|');

          currentCommit = {
            sha: sha.trim(),
            author: author.trim(),
            authorEmail: authorEmail.trim(),
            message: message.trim(),
            timestamp: new Date(dateStr.trim()),
          };

          // Reset stats for new commit
          currentStats = { added: 0, deleted: 0, files: 0 };
        }
      } else {
        // This is a file stat line (numstat format)
        const statParts = trimmedLine.split('\t');
        if (statParts.length >= 2) {
          const added = parseInt(statParts[0]) || 0;
          const deleted = parseInt(statParts[1]) || 0;
          const filename = statParts[2] || '';

          // Skip binary files and merge commits
          if (added !== 0 || deleted !== 0) {
            currentStats.added += added;
            currentStats.deleted += deleted;
            currentStats.files += 1;
          }
        }
      }
    }

    // Don't forget the last commit
    if (currentCommit && currentCommit.sha) {
      commits.push({
        ...currentCommit,
        linesAdded: currentStats.added,
        linesDeleted: currentStats.deleted,
        filesChanged: currentStats.files,
      } as CommitDetails);
    }

    this.logger.log(`📊 Extracted ${commits.length} commits with full metadata`);
    return commits;
  }

  /**
   * Get commit count in repository
   */
  async getCommitCount(repoPath: string): Promise<number> {
    try {
      const { stdout } = await execAsync('git rev-list --count HEAD', {
        cwd: repoPath,
        timeout: 60000,
      });
      return parseInt(stdout.trim()) || 0;
    } catch (error) {
      this.logger.error(`❌ Failed to get commit count:`, error);
      return 0;
    }
  }

  /**
   * Get repository information
   */
  async getRepositoryInfo(repoPath: string): Promise<{
    branch: string;
    remoteUrl: string;
    lastCommitDate: Date;
  }> {
    try {
      const [branchResult, remoteResult, lastCommitResult] = await Promise.all([
        execAsync('git branch --show-current', { cwd: repoPath }),
        execAsync('git remote get-url origin', { cwd: repoPath }),
        execAsync('git log -1 --format=%ad --date=iso', { cwd: repoPath }),
      ]);

      return {
        branch: branchResult.stdout.trim(),
        remoteUrl: remoteResult.stdout.trim(),
        lastCommitDate: new Date(lastCommitResult.stdout.trim()),
      };
    } catch (error) {
      this.logger.error(`❌ Failed to get repository info:`, error);
      throw error;
    }
  }
}
