import { Injectable } from '@nestjs/common';
import { PackageSearchService } from './package-search.service';
import { PackageCardDto, PackageDetailsDto } from '../dto/packages.dto';

@Injectable()
export class PackagesService {
  constructor(private readonly packageSearchService: PackageSearchService) {}

  async searchPackages(name: string): Promise<PackageCardDto[]> {
    const packages = await this.packageSearchService.searchPackages(name);
    return packages.map(pkg => this.transformToCard(pkg));
  }

  async getPackage(name: string, view: 'summary' | 'details'): Promise<PackageCardDto | PackageDetailsDto | null> {
    const packageData = await this.packageSearchService.getPackageDetails(name);
    
    if (!packageData) return null;
    
    return view === 'details' 
      ? this.transformToDetails(packageData)
      : this.transformToCard(packageData);
  }

  async forceRefreshCache(repoUrl?: string): Promise<{ clearedCount?: number; refreshed?: boolean }> {
    return await this.packageSearchService.forceRefreshCache(repoUrl);
  }

  // Transform to card format (NPM data only - no GitHub fields)
  private transformToCard(pkg: any): PackageCardDto {
    return {
      name: pkg.package_name,
      description: pkg.description || '',
      keywords: pkg.keywords || [],
      downloads: pkg.downloads || 0,
      maintainers: pkg.maintainers || [],
      last_updated: pkg.last_updated ? new Date(pkg.last_updated).toISOString().split('T')[0] : '',
      version: pkg.version || '',
      license: pkg.license || '',
      osv_vulnerabilities: pkg.osv_vulnerabilities || []
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
      last_updated: pkg.last_updated ? new Date(pkg.last_updated).toISOString().split('T')[0] : '',
      version: pkg.version || '',
      license: pkg.license || '',
      vulnerabilities: pkg.vulnerabilities || [],
      osv_vulnerabilities: pkg.osv_vulnerabilities || [],
      package_id: pkg.package_id || '',
      published: pkg.published_at ? new Date(pkg.published_at).toISOString().split('T')[0] : '',
      published_at: pkg.published_at,
      risk_score: pkg.risk_score || 0,
      npm_url: pkg.npm_url || '',
      // Optional GitHub fields (only included if available)
      ...(pkg.repo_url && { repo_url: pkg.repo_url }),
      ...(pkg.githubRepo?.repo_name && { repo_name: pkg.githubRepo.repo_name }),
      ...(pkg.homepage && { homepage: pkg.homepage }),
      ...(pkg.githubRepo?.stars && { stars: pkg.githubRepo.stars }),
      ...(pkg.githubRepo?.forks && { forks: pkg.githubRepo.forks }),
      ...(pkg.githubRepo?.contributors && { contributors: pkg.githubRepo.contributors })
    };
  }
} 