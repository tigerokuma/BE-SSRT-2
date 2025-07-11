import { Injectable } from '@nestjs/common';
import { PackagesRepository } from '../repositories/packages.repository';
import { PackageResponse } from '../dto/watchlist.dto';

@Injectable()
export class PackagesService {
  constructor(private readonly packagesRepository: PackagesRepository) {}

  async searchPackages(name: string): Promise<PackageResponse[]> {
    const packages = await this.packagesRepository.searchPackages(name);
    return packages.map(pkg => this.transformToSummary(pkg));
  }

  async getPackageSummary(name: string): Promise<PackageResponse | null> {
    const packageData = await this.packagesRepository.getPackageSummary(name);
    if (!packageData) return null;
    
    return this.transformToSummary(packageData);
  }

  async getPackageDetails(name: string): Promise<PackageResponse | null> {
    const packageData = await this.packagesRepository.getPackageDetails(name);
    if (!packageData) return null;
    
    return this.transformToDetails(packageData);
  }

  async getSimilarPackages(name: string): Promise<PackageResponse[]> {
    const packages = await this.packagesRepository.getSimilarPackages(name);
    return packages.map(pkg => this.transformToSummary(pkg));
  }

  // Transform to summary format (minimal fields, string dates)
  private transformToSummary(pkg: any): PackageResponse {
    return {
      name: pkg.package_name,
      description: pkg.description,
      version: pkg.version,
      published: pkg.published_at ? new Date(pkg.published_at).toISOString().split('T')[0] : undefined,
      last_updated: pkg.last_updated ? new Date(pkg.last_updated).toISOString().split('T')[0] : undefined,
      
      // GitHub stats
      stars: pkg.stars,
      forks: pkg.forks,
      repo_url: pkg.repo_url,
      
      // Package metadata
      maintainers: pkg.maintainers || [],
      keywords: pkg.keywords || [],
      license: pkg.license,
      downloads: pkg.downloads,
      
      // Links
      npm_url: pkg.npm_url,
      homepage: pkg.homepage
    };
  }

  // Transform to details format (all fields, includes IDs and dates)
  private transformToDetails(pkg: any): PackageResponse {
    return {
      // All summary fields
      ...this.transformToSummary(pkg),
      
      // Additional detail fields
      package_id: pkg.package_id,
      repo_name: pkg.repo_name,
      contributors: pkg.contributors,
      risk_score: pkg.risk_score,
      published_at: pkg.published_at,
      last_updated: pkg.last_updated  // Keep original Date object for details
    };
  }
} 