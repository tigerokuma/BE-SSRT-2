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

  async getPackage(name: string, view: 'summary' | 'details' | 'custom', customFields?: string[]): Promise<PackageResponse | null> {
    // For custom fields, we need details to have all available data
    const useDetails = view === 'details' || view === 'custom';
    
    const packageData = useDetails 
      ? await this.packagesRepository.getPackageDetails(name)
      : await this.packagesRepository.getPackageSummary(name);
    
    if (!packageData) return null;
    
    if (view === 'custom' && customFields) {
      return this.transformToCustomFields(packageData, customFields);
    }
    
    return view === 'details' 
      ? this.transformToDetails(packageData)
      : this.transformToSummary(packageData);
  }

  // Transform to custom fields format
  private transformToCustomFields(pkg: any, fields: string[]): PackageResponse {
    const fullData = this.transformToDetails(pkg);
    const result: Partial<PackageResponse> = {};
    
    // Map of internal field names to DTO field names
    const fieldMapping: Record<string, keyof PackageResponse> = {
      'id': 'package_id',
      'package_id': 'package_id',
      'name': 'name',
      'description': 'description',
      'version': 'version',
      'published': 'published',
      'published_at': 'published_at',
      'last_updated': 'last_updated',
      'stars': 'stars',
      'forks': 'forks',
      'repo_url': 'repo_url',
      'repo_name': 'repo_name',
      'contributors': 'contributors',
      'maintainers': 'maintainers',
      'keywords': 'keywords',
      'license': 'license',
      'downloads': 'downloads',
      'risk_score': 'risk_score',
      'npm_url': 'npm_url',
      'homepage': 'homepage'
    };

    // Always include name field as it's required
    result.name = fullData.name;

    // Include only requested fields
    for (const field of fields) {
      const mappedField = fieldMapping[field];
      if (mappedField && fullData[mappedField] !== undefined) {
        (result as any)[mappedField] = fullData[mappedField];
      }
    }

    return result as PackageResponse;
  }

  // Transform to summary format (minimal fields for cards)
  private transformToSummary(pkg: any): PackageResponse {
    return {
      name: pkg.package_name,
      description: pkg.description,
      keywords: pkg.keywords || [],
      downloads: pkg.downloads,
      maintainers: pkg.maintainers || [],
      last_updated: pkg.last_updated ? new Date(pkg.last_updated).toISOString().split('T')[0] : undefined,
      version: pkg.version,
      license: pkg.license
    };
  }

  // Transform to details format (all fields, includes IDs and dates)
  private transformToDetails(pkg: any): PackageResponse {
    return {
      // Core card fields (from summary)
      name: pkg.package_name,
      description: pkg.description,
      keywords: pkg.keywords || [],
      downloads: pkg.downloads,
      maintainers: pkg.maintainers || [],
      last_updated: pkg.last_updated, // Keep original Date object for details
      version: pkg.version,
      license: pkg.license,
      
      // Additional detail fields
      package_id: pkg.package_id,
      published: pkg.published_at ? new Date(pkg.published_at).toISOString().split('T')[0] : undefined,
      published_at: pkg.published_at,
      
      // GitHub stats
      stars: pkg.stars,
      forks: pkg.forks,
      repo_url: pkg.repo_url,
      repo_name: pkg.repo_name,
      contributors: pkg.contributors,
      
      // Risk and links
      risk_score: pkg.risk_score,
      npm_url: pkg.npm_url,
      homepage: pkg.homepage
    };
  }
} 