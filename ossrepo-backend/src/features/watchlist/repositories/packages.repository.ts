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
      
      // NEW: Add the NPM summary fieldsgit 
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
    console.log(`🚀 NEW SEARCH LOGIC: Searching for packages: ${name}`);
    
    // 1. ALWAYS return database results immediately (fast path)
    const dbResults = await this.searchPackagesInDb(name);
    
    // 2. Deduplicate immediately (safety net)
    const uniqueResults = this.deduplicateByPackageId(dbResults);
    
    // 3. Check if we have EXACT match with fresh data
    const exactMatch = uniqueResults.find(pkg => 
      pkg.package_name.toLowerCase() === name.toLowerCase()
    );
    
    if (exactMatch && this.isDataFresh(exactMatch.fetched_at)) {
      console.log(`Found fresh exact match for "${name}" + ${uniqueResults.length - 1} related packages`);
      
      // Background refresh for stale partial matches
      const hasStaleData = uniqueResults.some(pkg => 
        !pkg.fetched_at || !this.isDataFresh(pkg.fetched_at)
      );
      
      if (hasStaleData) {
        this.refreshPackagesInBackground(name).catch(err => 
          console.warn('Background refresh failed:', err.message)
        );
      }
      
      return uniqueResults;
    }
    
    // 4. No exact match OR stale exact match - search external APIs
    console.log(exactMatch 
      ? `Exact match "${name}" is stale - refreshing from external APIs`
      : `No exact match for "${name}" - searching external APIs (have ${uniqueResults.length} partial matches)`
    );
    
    try {
      const externalResults = await this.searchExternalAndCache(name);
      
      if (externalResults.length === 0) {
        console.log('No external results found - returning partial matches from DB');
        return uniqueResults;
      }
      
      // Combine external results + existing partial matches (avoid duplicates)
      const combined = [...externalResults];
      for (const dbPkg of uniqueResults) {
        const exists = combined.some(ext => 
          ext.package_name.toLowerCase() === dbPkg.package_name.toLowerCase()
        );
        if (!exists) {
          combined.push(dbPkg);
        }
      }
      
      // Sort: exact match first, then by downloads
      const sorted = combined.sort((a, b) => {
        const aExact = a.package_name.toLowerCase() === name.toLowerCase();
        const bExact = b.package_name.toLowerCase() === name.toLowerCase();
        
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;
        
        return (b.downloads || 0) - (a.downloads || 0);
      });
      
      console.log(`Returning ${sorted.length} results with "${name}" prioritized first`);
      return this.deduplicateByPackageId(sorted.slice(0, 10));
      
    } catch (error) {
      console.warn('External API search failed:', error.message);
      return uniqueResults; // Fallback to partial matches
         }
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
        { package_name: 'asc' },  //  Exact matches first
        { downloads: 'desc' },    //  Most weekly downloads first
        { stars: 'desc' },        //  Then by stars
        { fetched_at: 'desc' }    // Fresh data first
      ],
      take: 10  // Limit to 10 for user journey (library cards)
    });
  }
  // Optimized external search (only for cache misses)
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

  // Enhanced NPM caching with smart data combination
  private async quickCacheNpmResults(npmResults: any[]): Promise<Package[]> {
    const results: Package[] = [];
    
    // Step 1: Get enhanced NPM data efficiently  
    const enhancedNpmData = await this.getEnhancedNpmData(npmResults);
    
    for (let i = 0; i < npmResults.length; i++) {
      const originalSearch = npmResults[i];
      const detailsData = enhancedNpmData[i];
      
      try {
        // Step 2: Combine search + details data
        const combinedData = this.combineNpmData(originalSearch, detailsData);
        
        // Step 3: GitHub enrichment (if repo URL exists)
        if (combinedData.repo_url?.includes('github.com')) {
          try {
            const githubData = await this.getGitHubData(combinedData.repo_url);
            Object.assign(combinedData, githubData);
          } catch (githubError) {
            console.warn(`Failed to enrich ${combinedData.package_name} with GitHub data:`, githubError.message);
          }
        }
        
        const cached = await this.createOrUpdatePackage(combinedData);
        results.push(cached);
      } catch (error) {
        console.warn(`Failed to cache package ${originalSearch.name}:`, error.message);
      }
    }
    
    return results;
  }

  // Smart NPM data enhancement - only fetch what we need
  private async getEnhancedNpmData(npmResults: any[]): Promise<any[]> {
    const enhancedData: any[] = [];
    
    // Batch process in chunks to avoid overwhelming NPM API
    const CHUNK_SIZE = 3;
    for (let i = 0; i < npmResults.length; i += CHUNK_SIZE) {
      const chunk = npmResults.slice(i, i + CHUNK_SIZE);
      
      // Parallel fetch details for this chunk
      const chunkPromises = chunk.map(async (npmPkg) => {
        // Only fetch details if we need additional fields
        if (this.needsDetailedNpmData(npmPkg)) {
          try {
            return await this.npmService.getPackageDetails(npmPkg.name);
          } catch (error) {
            console.warn(`Failed to get details for ${npmPkg.name}:`, error.message);
            return null;
          }
        }
        return null;
      });
      
      const chunkResults = await Promise.all(chunkPromises);
      enhancedData.push(...chunkResults);
    }
    
    return enhancedData;
  }

  // Check if we need additional NPM details
  private needsDetailedNpmData(searchResult: any): boolean {
    // NPM search API doesn't provide keywords, license, or homepage
    // So we always need details for complete PackageSummary data
    return true;
  }

  // Intelligently combine search + details data
  private combineNpmData(searchData: any, detailsData: any) {
    return {
      package_name: searchData.name,
      repo_name: searchData.name,
      repo_url: searchData.repoUrl || detailsData?.repoUrl || searchData.npmUrl || '',
      
      // Prefer search data (more recent/accurate)
      description: searchData.description || detailsData?.description,
      version: searchData.version || detailsData?.version,
      last_updated: searchData.lastUpdated || detailsData?.lastUpdated,
      published_at: searchData.lastUpdated || detailsData?.lastUpdated,
      
      // Use details data for enhanced fields
      keywords: detailsData?.keywords || [],
      license: detailsData?.license,
      homepage: detailsData?.homepage,
      
      // Search-specific data
      downloads: searchData.weeklyDownloads,
      risk_score: searchData.score ? Math.round(searchData.score * 100) : null,
      npm_url: `https://npm.im/${searchData.name}`,
      
      // Will be filled by GitHub
      stars: null,
      forks: null,
      contributors: null,
      maintainers: [],
      pushed_at: searchData.lastUpdated || detailsData?.lastUpdated,
      fetched_at: new Date()
    };
  }

  // Optimized GitHub data fetching
  private async getGitHubData(repoUrl: string) {
    const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (!match) return {};
    
    const [, owner, repo] = match;
    const githubData = await this.githubService.getRepositoryDetails(owner, repo);
    
    return {
      stars: githubData.stargazers_count,
      forks: githubData.forks_count,
      contributors: githubData.contributors_count || null,
      repo_name: githubData.full_name,
      maintainers: [githubData.owner?.login || ''],
      last_updated: new Date(githubData.updated_at),
      pushed_at: new Date(githubData.pushed_at),
      
      // Only override if NPM data is missing
      description: githubData.description,
      keywords: githubData.topics?.length ? githubData.topics : [],
      license: githubData.license?.spdx_id
    };
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
        forks: githubData.forks_count,
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
} 