import { Injectable } from '@nestjs/common';
import { PackagesRepository } from '../repositories/packages.repository';
import { PackageSummary, PackageDetails } from '../dto/watchlist.dto';

@Injectable()
export class PackagesService {
  constructor(private readonly packagesRepository: PackagesRepository) {}

  async searchPackages(name: string): Promise<PackageSummary[]> {
    const packages = await this.packagesRepository.searchPackages(name);
    return packages.map(pkg => this.transformToSummary(pkg));
  }

  async getPackageSummary(name: string): Promise<PackageSummary | null> {
    const packageData = await this.packagesRepository.getPackageSummary(name);
    if (!packageData) return null;
    
    return this.transformToSummary(packageData);
  }

  async getPackageDetails(name: string): Promise<PackageDetails | null> {
    const packageData = await this.packagesRepository.getPackageDetails(name);
    if (!packageData) return null;
    
    return this.transformToDetails(packageData);
  }

  async getSimilarPackages(name: string): Promise<PackageSummary[]> {
    const packages = await this.packagesRepository.getSimilarPackages(name);
    return packages.map(pkg => this.transformToSummary(pkg));
  }

  // Transform full Package to NPM-style summary
  private transformToSummary(pkg: any): PackageSummary {
    return {
      name: pkg.package_name,
      description: pkg.description,
      version: pkg.version,
      published: pkg.published_at ? new Date(pkg.published_at).toISOString().split('T')[0] : undefined,
      
      // GitHub stats
      stars: pkg.stars,
      forks: pkg.forks,                              // Remove the "null" - just use pkg.forks
      repo_url: pkg.repo_url,
      
      // Package metadata
      maintainers: pkg.maintainers || [],
      keywords: pkg.keywords || [],
      license: pkg.license,
      downloads: pkg.downloads,
      
      // Links
      npm_url: pkg.npm_url,
      homepage: pkg.homepage,
      
      // Freshness
      last_updated: pkg.last_updated ? new Date(pkg.last_updated).toISOString().split('T')[0] : undefined
    };
  }

  // Transform full Package to detailed response
  private transformToDetails(pkg: any): PackageDetails {
    return {
      package_id: pkg.package_id,
      name: pkg.package_name,
      description: pkg.description,
      version: pkg.version,
      repo_url: pkg.repo_url,
      repo_name: pkg.repo_name,
      stars: pkg.stars,
      downloads: pkg.downloads,
      contributors: pkg.contributors,
      risk_score: pkg.risk_score,
      published_at: pkg.published_at,
      last_updated: pkg.last_updated,
      maintainers: pkg.maintainers || [],
      keywords: pkg.keywords || [],
      npm_url: pkg.npm_url,
      homepage: pkg.homepage,
      license: pkg.license
    };
  }
} 