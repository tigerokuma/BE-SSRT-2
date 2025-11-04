import { Injectable } from '@nestjs/common';
import { PackageSearchService } from './package-search.service';
import { PackageCardDto, PackageDetailsDto } from '../dto/packages.dto';
import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class PackagesService {
  constructor(
    private readonly packageSearchService: PackageSearchService,
    private readonly prisma: PrismaService,
  ) {}

  async searchPackages(name: string): Promise<PackageCardDto[]> {
    const packages = await this.packageSearchService.searchPackages(name);
    return packages.map((pkg) => this.transformToCard(pkg));
  }

  async getPackage(
    name: string,
    view: 'summary' | 'details',
  ): Promise<PackageCardDto | PackageDetailsDto | null> {
    const packageData = await this.packageSearchService.getPackageDetails(name);

    if (!packageData) return null;

    return view === 'details'
      ? this.transformToDetails(packageData)
      : this.transformToCard(packageData);
  }

  async forceRefreshCache(
    repoUrl?: string,
  ): Promise<{ clearedCount?: number; refreshed?: boolean }> {
    return await this.packageSearchService.forceRefreshCache(repoUrl);
  }

  // OSV Vulnerability methods for advanced use cases
  async getPackageVulnerabilities(name: string) {
    return await this.packageSearchService.getPackageVulnerabilities(name);
  }

  async searchVulnerabilities(packageName: string) {
    return await this.packageSearchService.searchVulnerabilities(packageName);
  }

  async getPackageById(
    id: string,
    version?: string,
    view: 'summary' | 'details' = 'details',
  ): Promise<PackageCardDto | PackageDetailsDto | null> {
    const packageData = await this.packageSearchService.getPackageById(id, version);

    if (!packageData) return null;

    return view === 'details'
      ? this.transformToDetails(packageData)
      : this.transformToCard(packageData);
  }

  async getDependencyById(
    id: string,
    version: string,
  ): Promise<PackageDetailsDto | null> {
    const packageData = await this.packageSearchService.getDependencyById(id, version);

    if (!packageData) return null;

    return this.transformDependencyToDetails(packageData, version);
  }

  async getPackageFromDatabase(
    packageId: string,
  ): Promise<PackageDetailsDto | null> {
    const packageData = await this.packageSearchService.getPackageFromDatabase(packageId);

    if (!packageData) return null;

    return this.transformDependencyToDetails(packageData);
  }

  async getRawPackageFromDatabase(
    packageId: string,
  ): Promise<any | null> {
    // Return raw data from Packages table without any transformation
    return await this.packageSearchService.getPackageFromDatabase(packageId);
  }

  // Transform to card format (NPM data only - no GitHub fields)
  private transformToCard(pkg: any): PackageCardDto {
    return {
      name: pkg.package_name,
      description: pkg.description || '',
      keywords: pkg.keywords || [],
      downloads: pkg.downloads || 0,
      maintainers: pkg.maintainers || [],
      last_updated: pkg.last_updated
        ? new Date(pkg.last_updated).toISOString().split('T')[0]
        : '',
      version: pkg.version || '',
      license: pkg.license || '',
      osv_vulnerabilities: pkg.osv_vulnerabilities || [],
    };
  }

  // Transform to details format (NPM + GitHub data)
  private transformToDetails(pkg: any): PackageDetailsDto {
    return {
      // All card fields (NPM data)
      name: pkg.package_name,
      description: pkg.description || '',
      keywords: pkg.keywords || [],
      downloads: pkg.downloads || 0,
      maintainers: pkg.maintainers || [],
      last_updated: pkg.last_updated
        ? new Date(pkg.last_updated).toISOString().split('T')[0]
        : '',
      version: pkg.version || '',
      license: pkg.license || '',
      osv_vulnerabilities: pkg.osv_vulnerabilities || [],
      package_id: pkg.package_id || '',
      published: pkg.published_at
        ? new Date(pkg.published_at).toISOString().split('T')[0]
        : '',
      published_at: pkg.published_at,
      risk_score: pkg.risk_score || 0,
      npm_url: pkg.npm_url || '',
      // Optional GitHub fields (only included if available)
      ...(pkg.repo_url && { repo_url: pkg.repo_url }),
      ...(pkg.githubRepo?.repo_name && { repo_name: pkg.githubRepo.repo_name }),
      ...(pkg.homepage && { homepage: pkg.homepage }),
      ...(pkg.githubRepo?.stars && { stars: pkg.githubRepo.stars }),
      ...(pkg.githubRepo?.forks && { forks: pkg.githubRepo.forks }),
      ...(pkg.githubRepo?.contributors && {
        contributors: pkg.githubRepo.contributors,
      }),
    };
  }

  // Transform dependency data (Packages table) to details format
  private transformDependencyToDetails(pkg: any, version?: string): PackageDetailsDto {
    return {
      name: pkg.name || '',
      description: pkg.summary || '',
      keywords: [],
      downloads: 0,
      maintainers: [],
      last_updated: pkg.updated_at 
        ? new Date(pkg.updated_at).toISOString().split('T')[0]
        : '',
      version: version || '',
      license: pkg.license || '',
      osv_vulnerabilities: pkg.osv_vulnerabilities || [],
      package_id: pkg.id || '',
      published: pkg.created_at 
        ? new Date(pkg.created_at).toISOString().split('T')[0]
        : '',
      published_at: pkg.created_at,
      risk_score: pkg.total_score || 0,
      npm_url: '',
      // Optional GitHub fields (only included if available)
      ...(pkg.repo_url && { repo_url: pkg.repo_url }),
      ...(pkg.githubRepo?.repo_name && { repo_name: pkg.githubRepo.repo_name }),
      ...(pkg.homepage && { homepage: pkg.homepage }),
      ...(pkg.githubRepo?.stars && { stars: pkg.githubRepo.stars }),
      ...(pkg.githubRepo?.forks && { forks: pkg.githubRepo.forks }),
      ...(pkg.githubRepo?.contributors && {
        contributors: pkg.githubRepo.contributors,
      }),
    };
  }

  /**
   * Get package commits with anomaly scores and contributor profiles
   */
  async getPackageCommits(packageId: string, limit: number = 50): Promise<any[]> {
    try {
      const commits = await this.prisma.$queryRaw<any[]>`
        SELECT 
          pc.id,
          pc.sha,
          pc.author,
          pc.author_email,
          pc.message,
          pc.timestamp,
          pc.lines_added,
          pc.lines_deleted,
          pc.files_changed,
          COALESCE(pa.anomaly_score, 0)::float as anomaly_score,
          pa.score_breakdown,
          contrib.total_commits,
          contrib.avg_lines_added,
          contrib.avg_lines_deleted,
          contrib.avg_files_changed,
          contrib.stddev_lines_added,
          contrib.stddev_lines_deleted,
          contrib.stddev_files_changed,
          contrib.commit_time_histogram,
          contrib.typical_days_active,
          contrib.commit_time_heatmap
        FROM package_commits pc
        LEFT JOIN package_anomalies pa ON pc.sha = pa.commit_sha
        LEFT JOIN package_contributors contrib ON contrib.package_id = pc.package_id 
          AND contrib.author_email = pc.author_email
        WHERE pc.package_id = ${packageId}
        ORDER BY pc.timestamp DESC
        LIMIT ${limit}
      `;

      return commits.map((commit) => ({
        id: commit.id,
        sha: commit.sha,
        author: commit.author,
        author_email: commit.author_email,
        message: commit.message,
        timestamp: commit.timestamp,
        lines_added: commit.lines_added,
        lines_deleted: commit.lines_deleted,
        files_changed: commit.files_changed,
        anomaly_score: commit.anomaly_score || 0,
        score_breakdown: commit.score_breakdown || [],
        contributor_profile: {
          total_commits: commit.total_commits || 0,
          avg_lines_added: commit.avg_lines_added || 0,
          avg_lines_deleted: commit.avg_lines_deleted || 0,
          avg_files_changed: commit.avg_files_changed || 0,
          stddev_lines_added: commit.stddev_lines_added || 0,
          stddev_lines_deleted: commit.stddev_lines_deleted || 0,
          stddev_files_changed: commit.stddev_files_changed || 0,
          commit_time_histogram: commit.commit_time_histogram || {},
          typical_days_active: commit.typical_days_active || {},
          commit_time_heatmap: commit.commit_time_heatmap || this.createEmptyHeatmap(),
        },
      }));
    } catch (error) {
      console.error(`❌ Failed to get package commits for ${packageId}:`, error);
      // Fallback query - just get commits without joins
      try {
        const commits = await this.prisma.packageCommit.findMany({
          where: { package_id: packageId },
          orderBy: { timestamp: 'desc' },
          take: limit,
        });

        return commits.map((commit) => ({
          id: commit.id,
          sha: commit.sha,
          author: commit.author,
          author_email: commit.author_email,
          message: commit.message,
          timestamp: commit.timestamp,
          lines_added: commit.lines_added,
          lines_deleted: commit.lines_deleted,
          files_changed: commit.files_changed,
          anomaly_score: 0,
          score_breakdown: [],
          contributor_profile: {
            total_commits: 0,
            avg_lines_added: 0,
            avg_lines_deleted: 0,
            avg_files_changed: 0,
            stddev_lines_added: 0,
            stddev_lines_deleted: 0,
            stddev_files_changed: 0,
            commit_time_histogram: {},
            typical_days_active: {},
            commit_time_heatmap: this.createEmptyHeatmap(),
          },
        }));
      } catch (fallbackError) {
        console.error(`❌ Fallback query also failed:`, fallbackError);
        return [];
      }
    }
  }

  /**
   * Create empty 7x24 heatmap (7 days, 24 hours)
   */
  private createEmptyHeatmap(): number[][] {
    return Array(7).fill(null).map(() => Array(24).fill(0));
  }
}
