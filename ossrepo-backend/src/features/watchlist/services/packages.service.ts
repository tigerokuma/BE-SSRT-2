import { Injectable } from '@nestjs/common';
import { PackageSearchService } from './package-search.service';
import { PackageCardDto, PackageDetailsDto } from '../dto/watchlist.dto';

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

  // Transform to card format (minimal fields for cards)
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
      
      // GitHub fields (may be null for NPM-only responses)
      stars: pkg.githubRepo?.stars || null,
      forks: pkg.githubRepo?.forks || null,
      contributors: pkg.githubRepo?.contributors || null
    };
  }

  // Transform to details format (all fields)
  private transformToDetails(pkg: any): PackageDetailsDto {
    return {
      // All card fields
      name: pkg.package_name,
      description: pkg.description || '',
      keywords: pkg.keywords || [],
      downloads: pkg.downloads || 0,
      maintainers: pkg.maintainers || [],
      last_updated: pkg.last_updated ? new Date(pkg.last_updated).toISOString().split('T')[0] : '',
      version: pkg.version || '',
      license: pkg.license || '',
      
      // Additional detail fields
      package_id: pkg.package_id || '',
      published: pkg.published_at ? new Date(pkg.published_at).toISOString().split('T')[0] : '',
      published_at: pkg.published_at,
      stars: pkg.githubRepo?.stars || 0,
      forks: pkg.githubRepo?.forks || 0,
      repo_url: pkg.repo_url || '',
      repo_name: pkg.githubRepo?.repo_name || pkg.repo_name || '',
      contributors: pkg.githubRepo?.contributors || 0,
      risk_score: pkg.risk_score || 0,
      npm_url: pkg.npm_url || '',
      homepage: pkg.homepage || ''
    };
  }
} 