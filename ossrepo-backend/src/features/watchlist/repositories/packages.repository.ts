import { Injectable } from '@nestjs/common';
import { Package } from 'generated/prisma';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { GitHubService } from '../services/github.service';
import { NPMService } from '../services/npm.service';

@Injectable()
export class PackagesRepository {
  constructor(private readonly prisma: PrismaService, private readonly githubService: GitHubService, private readonly npmService: NPMService) {}

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
      where: { repo_url: packageData.repo_url! },
      update: {
      // Existing fields
      package_name: packageData.package_name,
      repo_name: packageData.repo_name,
      downloads: packageData.downloads,
      last_updated: packageData.last_updated,
      stars: packageData.stars,
      contributors: packageData.contributors,
      pushed_at: packageData.pushed_at,
      risk_score: packageData.risk_score,
      fetched_at: new Date(),
      
      // NEW: Add the NPM summary fields
      description: packageData.description,
      version: packageData.version,
      published_at: packageData.published_at,
      maintainers: packageData.maintainers,
      keywords: packageData.keywords,
      npm_url: packageData.npm_url,
      homepage: packageData.homepage,
      license: packageData.license,
      forks: packageData.forks // NEW: Add forks
    },
    create: {
      // Required fields
      repo_url: packageData.repo_url!,
      package_name: packageData.package_name!,
      repo_name: packageData.repo_name || '',
      
      // Existing fields
      downloads: packageData.downloads,
      last_updated: packageData.last_updated,
      stars: packageData.stars,
      contributors: packageData.contributors,
      pushed_at: packageData.pushed_at,
      risk_score: packageData.risk_score,
      fetched_at: new Date(),
      
      // NEW: Add the NPM summary fields
      description: packageData.description,
      version: packageData.version,
      published_at: packageData.published_at,
      maintainers: packageData.maintainers || [],
      keywords: packageData.keywords || [],
      npm_url: packageData.npm_url,
      homepage: packageData.homepage,
      license: packageData.license,
      forks: packageData.forks // NEW: Add forks
    }
  });
}

  async searchPackages(name: string): Promise<Package[]> {
    console.log(`Searching for packages: ${name}`);
    
    // 1. ALWAYS return database results immediately (fast path)
    const dbResults = await this.searchPackagesInDb(name);
    
    // 2. Deduplicate immediately (safety net)
    const uniqueResults = this.deduplicateByPackageId(dbResults);
    
    // 3. Check if we have ANY results to return
    if (uniqueResults.length > 0) {
      console.log(`Found ${uniqueResults.length} packages in database`);
      
      // 4. Check staleness and trigger background refresh if needed
      const hasStaleData = uniqueResults.some(pkg => 
        !pkg.fetched_at || !this.isDataFresh(pkg.fetched_at)
      );
      
      if (hasStaleData) {
        console.log('Triggering background refresh for stale data');
        // Fire-and-forget background refresh (don't await!)
        this.refreshPackagesInBackground(name).catch(err => 
          console.warn('Background refresh failed:', err.message)
        );
      }
      
      // Return immediately with cached data
      return uniqueResults;
    }
    
    // 5. No database results - do ONE external search (blocking)
    console.log('No cached data, searching external APIs');
    return this.searchExternalAndCache(name);
  }

  private async searchPackagesInDb(name: string): Promise<Package[]> {
    return this.prisma.package.findMany({
      where: {
        OR: [
          { package_name: { equals: name, mode: 'insensitive' } },      // Exact match first
          { package_name: { contains: name, mode: 'insensitive' } },    // Partial match
          { repo_name: { contains: name, mode: 'insensitive' } }        // Repo name match
        ]
      },
      orderBy: [
        { package_name: 'asc' },  // Exact matches first
        { stars: 'desc' },        // Popular packages first
        { fetched_at: 'desc' }    // Fresh data first
      ],
      take: 20  // Limit results for performance
    });
  }

  // Simplified external search (only for cache misses)
  private async searchExternalAndCache(name: string): Promise<Package[]> {
    try {
      // Try NPM first (fastest, most relevant)
      const npmResults = await this.npmService.searchPackages(name, 5); // Limit to 5 for speed
      
      if (npmResults.length > 0) {
        console.log(`Found ${npmResults.length} packages from NPM`);
        const cachedResults = await this.quickCacheNpmResults(npmResults);
        return this.deduplicateByPackageId(cachedResults);
      }
    } catch (npmError) {
      console.warn('NPM search failed:', npmError.message);
    }
    
    // Fallback to GitHub (only if NPM completely fails)
    try {
      const githubResults = await this.githubService.searchRepositories(name);
      const cachedResults = await this.quickCacheGitHubResults(githubResults.slice(0, 5)); // Limit for speed
      return this.deduplicateByPackageId(cachedResults);
    } catch (githubError) {
      console.warn('GitHub search failed:', githubError.message);
      return [];
    }
  }

  // Background refresh (fire-and-forget)
  private async refreshPackagesInBackground(name: string): Promise<void> {
    try {
      console.log(`Background refresh starting for: ${name}`);
      
      // Get current stale packages
      const stalePackages = await this.prisma.package.findMany({
        where: {
          package_name: { contains: name, mode: 'insensitive' },
          OR: [
            { fetched_at: null },
            { fetched_at: { lt: new Date(Date.now() - 12 * 60 * 60 * 1000) } } // 12 hours ago
          ]
        }
      });
      
      if (stalePackages.length === 0) return;
      
      // Refresh each package individually (no batch for simplicity)
      for (const pkg of stalePackages.slice(0, 5)) { // Limit to 5 for background job
        try {
          if (pkg.repo_url) {
            const match = pkg.repo_url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
            if (match) {
              const [, owner, repo] = match;
              const githubData = await this.githubService.getRepositoryDetails(owner, repo);
              await this.updatePackageFromGitHub(pkg.package_id, githubData);
            }
          }
        } catch (error) {
          console.warn(`Failed to refresh package ${pkg.package_name}:`, error.message);
        }
      }
      
      console.log(`Background refresh completed for ${stalePackages.length} packages`);
    } catch (error) {
      console.error('Background refresh error:', error.message);
    }
  }

  // Enhanced NPM caching with complete data
  private async quickCacheNpmResults(npmResults: any[]): Promise<Package[]> {
    const results: Package[] = [];
    
    for (const npmPkg of npmResults) {
      try {
        // Get basic search data
        const basicData = this.transformNpmData(npmPkg);
        
        // ENHANCED: Fetch complete package details
        const detailedData = await this.npmService.getPackageDetails(npmPkg.name);
        
        // Merge basic + detailed data
        const completeData = {
          ...basicData,
          // Override with detailed info
          description: detailedData?.description || basicData.description,
          homepage: detailedData?.homepage,
          keywords: detailedData?.keywords || [],
          license: detailedData?.license,
          // Keep the repo URL from GitHub if available
          repo_url: detailedData?.repoUrl || basicData.repo_url,
        };
        
        // If we have a GitHub repo, enrich with GitHub data too
        if (completeData.repo_url && completeData.repo_url.includes('github.com')) {
          try {
            const match = completeData.repo_url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
            if (match) {
              const [, owner, repo] = match;
              const githubData = await this.githubService.getRepositoryDetails(owner, repo);
              
              // Merge NPM + GitHub data for complete package info
              completeData.stars = githubData.stargazers_count;
              completeData.contributors = githubData.contributors_count || null;
              completeData.repo_name = githubData.full_name;
              // Keep NPM description if better, otherwise use GitHub
              completeData.description = completeData.description || githubData.description;
            }
          } catch (githubError) {
            console.warn(`Failed to enrich ${npmPkg.name} with GitHub data:`, githubError.message);
          }
        }
        
        const cached = await this.createOrUpdatePackage(completeData);
        results.push(cached);
      } catch (error) {
        console.warn(`Failed to cache NPM package ${npmPkg.name}:`, error.message);
      }
    }
    
    return results;
  }

  // Quick GitHub caching
  private async quickCacheGitHubResults(githubResults: any[]): Promise<Package[]> {
    const results: Package[] = [];
    
    for (const repo of githubResults) {
      try {
        const packageData = this.transformGitHubData(repo);
        const cached = await this.createOrUpdatePackage(packageData);
        results.push(cached);
      } catch (error) {
        console.warn(`Failed to cache GitHub repo ${repo.name}:`, error.message);
      }
    }
    
    return results;
  }

  // Simple deduplication utility
  private deduplicateByPackageId(packages: Package[]): Package[] {
    const seen = new Set<string>();
    return packages.filter(pkg => {
      if (seen.has(pkg.package_id)) {
        console.warn(`Duplicate package_id detected: ${pkg.package_id} (${pkg.package_name})`);
        return false;
      }
      seen.add(pkg.package_id);
      return true;
    });
  }

  // Update existing package with GitHub data
  private async updatePackageFromGitHub(packageId: string, githubData: any): Promise<void> {
    await this.prisma.package.update({
      where: { package_id: packageId },
      data: {
        stars: githubData.stargazers_count,
        contributors: githubData.contributors_count || null,
        pushed_at: new Date(githubData.pushed_at),
        last_updated: new Date(githubData.updated_at),
        fetched_at: new Date()
      }
    });
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

  private transformNpmData(npmPkg: any) {
    return {
      package_name: npmPkg.name,
      repo_name: npmPkg.name,
      repo_url: npmPkg.repoUrl || npmPkg.npmUrl || '',
      stars: null, // Will be filled by GitHub API
      downloads: npmPkg.weeklyDownloads,
      last_updated: npmPkg.lastUpdated,
      pushed_at: npmPkg.lastUpdated,
      contributors: null, // Will be filled by GitHub API
      risk_score: npmPkg.score ? Math.round(npmPkg.score * 100) : null,
      
      // NPM fields
      description: npmPkg.description,
      version: npmPkg.version,
      published_at: npmPkg.lastUpdated,
      maintainers: [], // Will be enhanced by getPackageDetails
      keywords: npmPkg.keywords || [],
      npm_url: `https://npm.im/${npmPkg.name}`,
      homepage: null, // Will be enhanced by getPackageDetails
      license: null // Will be enhanced by getPackageDetails
    };
  }
  
  private transformGitHubData(gitHubRepo: any) {
    return {
      package_name: gitHubRepo.name,
      repo_name: gitHubRepo.full_name,
      repo_url: gitHubRepo.html_url,
      stars: gitHubRepo.stargazers_count,
      forks: gitHubRepo.forks_count,                    // NEW: Add forks
      contributors: gitHubRepo.contributors_count || null,
      last_updated: new Date(gitHubRepo.updated_at),
      pushed_at: new Date(gitHubRepo.pushed_at),
      downloads: null,
      risk_score: null,
      
      description: gitHubRepo.description,
      version: null,
      published_at: new Date(gitHubRepo.created_at),
      maintainers: [gitHubRepo.owner?.login || ''],
      keywords: gitHubRepo.topics || [],
      npm_url: null,
      homepage: gitHubRepo.homepage,
      license: gitHubRepo.license?.spdx_id
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