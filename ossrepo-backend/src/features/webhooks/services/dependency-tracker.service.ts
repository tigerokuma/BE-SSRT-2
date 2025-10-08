import { Injectable, Logger } from '@nestjs/common';
import { GitHubService } from '../../../common/github/github.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

interface DependencyChange {
  name: string;
  oldVersion?: string;
  newVersion: string;
  changeType: 'added' | 'updated' | 'removed';
}

interface DependencyAnalysis {
  added: DependencyChange[];
  updated: DependencyChange[];
  removed: DependencyChange[];
  unchanged: DependencyChange[];
}

@Injectable()
export class DependencyTrackerService {
  private readonly logger = new Logger(DependencyTrackerService.name);

  constructor(
    private readonly gitHubService: GitHubService,
    private readonly prisma: PrismaService
  ) {}

  /**
   * Extract dependencies from package.json file content
   */
  async extractDependenciesFromPackageJson(
    owner: string,
    repo: string,
    ref: string
  ): Promise<{ [key: string]: string }> {
    try {
      const octokit = await this.gitHubService.getAuthenticatedOctokit();
      
      // Get package.json content
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: 'package.json',
        ref
      });

      if ('content' in data) {
        const content = Buffer.from(data.content, 'base64').toString('utf-8');
        const packageJson = JSON.parse(content);
        
        // Clean up version strings by removing prefixes like ^, ~, >=, etc.
        const cleanDependencies = (deps: any) => {
          const cleaned: { [key: string]: string } = {};
          for (const [name, version] of Object.entries(deps || {})) {
            // Remove common version prefixes
            const cleanVersion = (version as string).replace(/^[\^~>=<]/, '');
            cleaned[name] = cleanVersion;
          }
          return cleaned;
        };
        
        return {
          ...cleanDependencies(packageJson.dependencies),
          ...cleanDependencies(packageJson.devDependencies),
          ...cleanDependencies(packageJson.peerDependencies)
        };
      }

      return {};
    } catch (error) {
      this.logger.error(`❌ Error extracting dependencies from package.json:`, error.message);
      return {};
    }
  }

  /**
   * Get current dependencies for a monitored branch
   */
  async getCurrentBranchDependencies(monitoredBranchId: string): Promise<{ [key: string]: string }> {
    try {
      const dependencies = await this.prisma.branchDependency.findMany({
        where: { monitored_branch_id: monitoredBranchId },
        select: { name: true, version: true }
      });

      const result: { [key: string]: string } = {};
      dependencies.forEach(dep => {
        result[dep.name] = dep.version;
      });

      return result;
    } catch (error) {
      this.logger.error(`❌ Error getting current branch dependencies:`, error.message);
      return {};
    }
  }

  /**
   * Compare old and new dependencies and identify changes
   */
  compareDependencies(
    oldDeps: { [key: string]: string },
    newDeps: { [key: string]: string }
  ): DependencyAnalysis {
    const analysis: DependencyAnalysis = {
      added: [],
      updated: [],
      removed: [],
      unchanged: []
    };

    // Find added and updated dependencies
    for (const [name, newVersion] of Object.entries(newDeps)) {
      if (!oldDeps[name]) {
        analysis.added.push({
          name,
          newVersion,
          changeType: 'added'
        });
      } else if (oldDeps[name] !== newVersion) {
        analysis.updated.push({
          name,
          oldVersion: oldDeps[name],
          newVersion,
          changeType: 'updated'
        });
      } else {
        analysis.unchanged.push({
          name,
          newVersion,
          changeType: 'updated'
        });
      }
    }

    // Find removed dependencies
    for (const [name, oldVersion] of Object.entries(oldDeps)) {
      if (!newDeps[name]) {
        analysis.removed.push({
          name,
          oldVersion,
          newVersion: '',
          changeType: 'removed'
        });
      }
    }

    return analysis;
  }

  /**
   * Update branch dependencies in database
   */
  async updateBranchDependencies(
    monitoredBranchId: string,
    newDependencies: { [key: string]: string }
  ): Promise<void> {
    try {
      // Clear existing dependencies
      await this.prisma.branchDependency.deleteMany({
        where: { monitored_branch_id: monitoredBranchId }
      });

      // Add new dependencies
      if (Object.keys(newDependencies).length > 0) {
        await this.prisma.branchDependency.createMany({
          data: Object.entries(newDependencies).map(([name, version]) => ({
            monitored_branch_id: monitoredBranchId,
            name,
            version
          }))
        });
      }

      // Silent update
    } catch (error) {
      this.logger.error(`❌ Error updating branch dependencies:`, error.message);
    }
  }

  /**
   * Log dependency changes in a simple format
   */
  logDependencyChanges(analysis: DependencyAnalysis): void {
    const totalChanges = analysis.added.length + analysis.updated.length + analysis.removed.length;
    
    if (totalChanges > 0) {
      const changes = [];
      if (analysis.added.length > 0) changes.push(`+${analysis.added.length} new`);
      if (analysis.updated.length > 0) changes.push(`~${analysis.updated.length} updated`);
      if (analysis.removed.length > 0) changes.push(`-${analysis.removed.length} removed`);
      
      this.logger.log(`📦 Dependencies changed: ${changes.join(', ')}`);
    }
  }

  /**
   * Full workflow: analyze and update dependencies for a branch
   */
  async analyzeAndUpdateDependencies(
    owner: string,
    repo: string,
    ref: string,
    monitoredBranchId: string
  ): Promise<void> {
    try {
      // Get new dependencies from package.json
      const newDependencies = await this.extractDependenciesFromPackageJson(owner, repo, ref);
      
      if (Object.keys(newDependencies).length === 0) {
        return;
      }

      // Get current dependencies from database
      const currentDependencies = await this.getCurrentBranchDependencies(monitoredBranchId);

      // Compare dependencies
      const analysis = this.compareDependencies(currentDependencies, newDependencies);

      // Log changes
      this.logDependencyChanges(analysis);

      // Update database with new dependencies
      await this.updateBranchDependencies(monitoredBranchId, newDependencies);

    } catch (error) {
      this.logger.error(`❌ Error in dependency analysis workflow:`, error.message);
    }
  }
}
