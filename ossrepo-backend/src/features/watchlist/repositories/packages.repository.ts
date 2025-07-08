import { Injectable } from '@nestjs/common';
import { Package } from 'generated/prisma';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { GitHubService } from '../services/github.service';

@Injectable()
export class PackagesRepository {
  constructor(private readonly prisma: PrismaService, private readonly githubService: GitHubService) {}

  async findPackageByUrl(repoUrl: string): Promise<Package | null> {
    return this.prisma.package.findUnique({
      where: { repo_url: repoUrl }
    });
  }

  async findPackagesByName(packageName: string): Promise<Package[]> {
    return this.prisma.package.findMany({
      where: { package_name: packageName }
    });
  }

  async createOrUpdatePackage(packageData: Partial<Package>): Promise<Package> {
    return this.prisma.package.upsert({
      where: { repo_url: packageData.repo_url! },  // Use repo_url for lookup
      update: {

        // Update these fields:
        package_name: packageData.package_name,
        repo_name: packageData.repo_name,
        downloads: packageData.downloads,
        last_updated: packageData.last_updated,
        stars: packageData.stars,
        contributors: packageData.contributors,
        pushed_at: packageData.pushed_at,
        risk_score: packageData.risk_score,
        fetched_at: new Date()
      },
      create: {
        // Create needs all required fields:
        repo_url: packageData.repo_url!,        // Required unique field
        package_name: packageData.package_name!,
        repo_name: packageData.repo_name || '',
        downloads: packageData.downloads,
        last_updated: packageData.last_updated,
        stars: packageData.stars,
        contributors: packageData.contributors,
        pushed_at: packageData.pushed_at,
        risk_score: packageData.risk_score,
        fetched_at: new Date()
      }
    });
  }


  async searchPackages(name: string): Promise<Package[]> {
    // 1. First, search in our database
    const dbResults = await this.findPackagesByName(name);
    
    if (dbResults.length > 0) {
      // Check if data is fresh (less than 12 hours old)
      const freshResults = dbResults.filter(pkg => 
        pkg.fetched_at && this.isDataFresh(pkg.fetched_at)
      );
      
      if (freshResults.length > 0) {
        console.log(`Found ${freshResults.length} fresh results in database`);
        return freshResults;
      }
    }

    // 2. If no fresh data, search GitHub API
    console.log(`Searching GitHub API for: ${name}`);
    try {
      const gitHubResults = await this.githubService.searchRepositories(name);
      
      // 3. Transform and cache the results
      const cachedResults: Package[] = [];
      for (const gitHubRepo of gitHubResults) {
        const packageData = this.transformGitHubData(gitHubRepo);
        const cachedPackage = await this.createOrUpdatePackage(packageData);
        cachedResults.push(cachedPackage);
      }
      
      console.log(`Cached ${cachedResults.length} packages from GitHub`);
      return cachedResults;
      
    } catch (error) {
      // 4. Fallback to stale database data if API fails
      if (dbResults.length > 0) {
        console.log('GitHub API failed, returning stale database results');
        return dbResults;
      }
      
      throw error;
    }
  }

  async getPackageSummary(name: string): Promise<Package | null> {
    // 1. Try to find by exact package name
    let packageData = await this.findPackageByUrl(name);
    
    if (packageData && this.isDataFresh(packageData.fetched_at)) {
      return packageData;
    }

    // 2. If not found or stale, try to get from GitHub
    try {
      // Assume the name is in format "owner/repo" or just "repo"
      const [owner, repo] = name.includes('/') ? name.split('/') : ['', name];
      
      if (owner && repo) {
        const gitHubData = await this.githubService.getRepositoryDetails(owner, repo);
        const transformedData = this.transformGitHubData(gitHubData);
        return await this.createOrUpdatePackage(transformedData);
      }
      
      // If no owner specified, fall back to search
      const searchResults = await this.searchPackages(name);
      return searchResults[0] || null;
      
    } catch (error) {
      console.error('Failed to fetch from GitHub:', error);
      return packageData; // Return stale data if available
    }
  }

  private isDataFresh(fetchedAt: Date | null): boolean {
    if (!fetchedAt) return false;
    const hoursAgo = (Date.now() - fetchedAt.getTime()) / (1000 * 60 * 60);
    return hoursAgo < 12; // Fresh if less than 12 hours old
  }

  private transformGitHubData(gitHubRepo: any) {
    return {
      package_name: gitHubRepo.name,
      repo_name: gitHubRepo.full_name,
      repo_url: gitHubRepo.html_url,
      stars: gitHubRepo.stargazers_count,
      last_updated: new Date(gitHubRepo.updated_at),
      pushed_at: new Date(gitHubRepo.pushed_at),
      contributors: gitHubRepo.contributors_count || null,
      downloads: null,
      risk_score: null
    };
  }


  async getPackageDetails(name: string): Promise<Package | null> {
    // For now, use the same logic as getPackageSummary
    // Later you can add more detailed logic here
    return this.getPackageSummary(name);
  }

  
  // TODO: Implement similar packages recommendation logic
  // - Analyze package categories/tags
  // - Find packages with similar usage patterns
  // - Return PackageSummary[]
  async getSimilarPackages(name: string): Promise<Package[]> {
    // Simple implementation: search for packages with similar names
    if (name.length < 2) return [];
    
    try {
      const results = await this.searchPackages(name);
      // Return up to 5 similar packages, excluding exact matches
      return results
        .filter(pkg => pkg.package_name !== name)
        .slice(0, 5);
    } catch (error) {
      console.error('Error finding similar packages:', error);
      return [];
    }
  }

  async cachePackageData(packageName: string, data: any) {
    // TODO: Implement caching mechanism
    // - Store package data in cache (Redis, etc.)
    // - Set appropriate TTL
    throw new Error('Not implemented');
  }
} 