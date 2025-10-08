import { Injectable, Logger } from '@nestjs/common';
import { GitHubService } from '../../../common/github/github.service';

@Injectable()
export class PackageChangeDetectorService {
  private readonly logger = new Logger(PackageChangeDetectorService.name);

  constructor(private readonly gitHubService: GitHubService) {}

  /**
   * Check if a commit changes package.json
   */
  async checkCommitForPackageJsonChanges(
    owner: string,
    repo: string,
    commitSha: string
  ): Promise<{
    hasPackageJsonChanges: boolean;
    filesChanged: string[];
    packageJsonFiles: string[];
  }> {
    try {
      const octokit = await this.gitHubService.getAuthenticatedOctokit();
      
      // Get commit details including files changed
      const { data: commit } = await octokit.rest.repos.getCommit({
        owner,
        repo,
        ref: commitSha,
      });

      const filesChanged = commit.files?.map(file => file.filename) || [];
      
      // Check for package.json files (including package-lock.json, yarn.lock, etc.)
      const packageJsonFiles = filesChanged.filter(filename => 
        filename === 'package.json' ||
        filename === 'package-lock.json' ||
        filename === 'yarn.lock' ||
        filename === 'pnpm-lock.yaml' ||
        filename.endsWith('/package.json')
      );

      const hasPackageJsonChanges = packageJsonFiles.length > 0;

      // Silent analysis - only log results in main controller

      return {
        hasPackageJsonChanges,
        filesChanged,
        packageJsonFiles
      };
    } catch (error) {
      this.logger.error(`❌ Error checking commit ${commitSha} for package.json changes:`, error.message);
      return {
        hasPackageJsonChanges: false,
        filesChanged: [],
        packageJsonFiles: []
      };
    }
  }

  /**
   * Check if a pull request changes package.json
   */
  async checkPullRequestForPackageJsonChanges(
    owner: string,
    repo: string,
    pullNumber: number
  ): Promise<{
    hasPackageJsonChanges: boolean;
    filesChanged: string[];
    packageJsonFiles: string[];
  }> {
    try {
      const octokit = await this.gitHubService.getAuthenticatedOctokit();
      
      // Get PR files
      const { data: files } = await octokit.rest.pulls.listFiles({
        owner,
        repo,
        pull_number: pullNumber,
      });

      const filesChanged = files.map(file => file.filename);
      
      // Check for package.json files
      const packageJsonFiles = filesChanged.filter(filename => 
        filename === 'package.json' ||
        filename === 'package-lock.json' ||
        filename === 'yarn.lock' ||
        filename === 'pnpm-lock.yaml' ||
        filename.endsWith('/package.json')
      );

      const hasPackageJsonChanges = packageJsonFiles.length > 0;

      // Silent analysis - only log results in main controller

      return {
        hasPackageJsonChanges,
        filesChanged,
        packageJsonFiles
      };
    } catch (error) {
      this.logger.error(`❌ Error checking PR #${pullNumber} for package.json changes:`, error.message);
      return {
        hasPackageJsonChanges: false,
        filesChanged: [],
        packageJsonFiles: []
      };
    }
  }

  /**
   * Check multiple commits for package.json changes
   */
  async checkCommitsForPackageJsonChanges(
    owner: string,
    repo: string,
    commitShas: string[]
  ): Promise<{
    totalCommits: number;
    commitsWithPackageJsonChanges: number;
    commitsWithoutPackageJsonChanges: number;
    details: Array<{
      commitSha: string;
      hasPackageJsonChanges: boolean;
      packageJsonFiles: string[];
    }>;
  }> {
    const details = [];
    let commitsWithPackageJsonChanges = 0;
    let commitsWithoutPackageJsonChanges = 0;

    for (const commitSha of commitShas) {
      const result = await this.checkCommitForPackageJsonChanges(owner, repo, commitSha);
      
      details.push({
        commitSha,
        hasPackageJsonChanges: result.hasPackageJsonChanges,
        packageJsonFiles: result.packageJsonFiles
      });

      if (result.hasPackageJsonChanges) {
        commitsWithPackageJsonChanges++;
      } else {
        commitsWithoutPackageJsonChanges++;
      }
    }

    // Silent analysis - only log results in main controller

    return {
      totalCommits: commitShas.length,
      commitsWithPackageJsonChanges,
      commitsWithoutPackageJsonChanges,
      details
    };
  }
}
