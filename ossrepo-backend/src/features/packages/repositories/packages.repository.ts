import { Injectable } from '@nestjs/common';
import { Package } from 'generated/prisma';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { GitHubService } from '../services/github.service';
import { NPMService } from '../services/npm.service';

@Injectable()
export class PackagesRepository {
  constructor(private readonly prisma: PrismaService, private readonly githubService: GitHubService, private readonly npmService: NPMService) {}

  async findPackagesByUrl(repoUrl: string): Promise<Package[]> {
    return this.prisma.package.findMany({
      where: { repo_url: repoUrl }
    });
  }

  async findPackageByName(packageName: string): Promise<Package | null> {
    return this.prisma.package.findUnique({
      where: { package_name: packageName }
    });
  }

  async createOrUpdatePackage(packageData: Partial<Package>): Promise<Package> {
    return this.prisma.package.upsert({
      where: { package_name: packageData.package_name! },
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

  async searchPackages(name: string): Promise<(Package | Partial<Package>)[]> {
    console.log(`🚀 NEW SEARCH LOGIC: Searching for packages: ${name}`);

    // 1. ALWAYS return database results immediately (fast path)
    const dbResults = await this.searchPackagesInDb(name);

    // 2. Deduplicate by name for consistency
    const uniqueDbResults = this.deduplicateByName(dbResults);

    // 3. Check if we have an EXACT match with fresh data
    const exactMatch = uniqueDbResults.find((pkg) => pkg.package_name.toLowerCase() === name.toLowerCase());

    if (exactMatch && this.isDataFresh(exactMatch.fetched_at)) {
      console.log(`Found fresh exact match for "${name}" + ${uniqueDbResults.length - 1} related packages`);

      const hasStaleData = uniqueDbResults.some((pkg) => !pkg.fetched_at || !this.isDataFresh(pkg.fetched_at));
      if (hasStaleData) {
        this.refreshPackagesInBackground(name).catch((err) => console.warn('Background refresh failed:', err.message));
      }

      return uniqueDbResults;
    }

    // 4. No exact match OR stale exact match - search external APIs
    console.log(
      exactMatch
        ? `Exact match "${name}" is stale - refreshing from external APIs`
        : `No exact match for "${name}" - searching external APIs (have ${uniqueDbResults.length} partial matches)`
    );

    try {
      const externalResults = await this.searchExternalAndInitiateCache(name);

      if (externalResults.length === 0) {
        console.log('No external results found - returning partial matches from DB');
        return uniqueDbResults;
      }

      // Combine external results + existing partial matches (avoid duplicates by name)
      const combined = [...externalResults];
      for (const dbPkg of uniqueDbResults) {
        const exists = combined.some((ext) => ext.package_name?.toLowerCase() === dbPkg.package_name.toLowerCase());
        if (!exists) {
          combined.push(dbPkg);
        }
      }

      // Sort: exact match first, then by downloads
      const sorted = combined.sort((a, b) => {
        const aExact = a.package_name?.toLowerCase() === name.toLowerCase();
        const bExact = b.package_name?.toLowerCase() === name.toLowerCase();

        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;

        return (b.downloads || 0) - (a.downloads || 0);
      });

      console.log(`Returning ${sorted.length} results with "${name}" prioritized first`);
      return this.deduplicateByName(sorted).slice(0, 10);
    } catch (error) {
      console.warn('External API search failed:', error.message);
      return uniqueDbResults; // Fallback to partial matches
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

  private async searchExternalAndInitiateCache(name: string): Promise<Partial<Package>[]> {
    try {
      const npmResults = await this.npmService.searchPackages(name, 5);
      if (npmResults.length === 0) return [];

      console.log(`Found ${npmResults.length} from NPM, fetching details for immediate response...`);

      const fastTrackPromises = npmResults.map(async (searchResult) => {
        try {
          const detailsData = await this.npmService.getPackageDetails(searchResult.name);
          return this.combineNpmData(searchResult, detailsData);
        } catch (error) {
          console.warn(`Failed to get details for ${searchResult.name}:`, error.message);
          return this.combineNpmData(searchResult, null);
        }
      });

      const partialPackages = await Promise.all(fastTrackPromises);

      this.enrichAndCacheInBackground(partialPackages).catch((err) => {
        console.error('Background enrichment failed:', err.message);
      });

      return partialPackages;
    } catch (npmError) {
      console.warn('NPM search failed:', npmError.message);
      return [];
    }
  }

  private async enrichAndCacheInBackground(packagesToEnrich: Partial<Package>[]): Promise<void> {
    console.log(`Starting background enrichment for ${packagesToEnrich.length} packages.`);

    const enrichmentPromises = packagesToEnrich.map(async (npmData) => {
      try {
        let enrichedData = { ...npmData };
        if (npmData.repo_url?.includes('github.com')) {
          try {
            const githubData = await this.getGitHubData(npmData.repo_url);
            enrichedData = { ...githubData, ...npmData };
          } catch (githubError) {
            console.warn(`Background GitHub fetch failed for ${npmData.package_name}:`, githubError.message);
          }
        }
        await this.createOrUpdatePackage(enrichedData);
      } catch (error) {
        console.warn(`Failed to enrich and cache package ${npmData.package_name}: ${error.message}`);
      }
    });

    await Promise.all(enrichmentPromises);
    console.log('Background enrichment and caching complete.');
  }

  private async enrichPackage(npmData: Partial<Package>): Promise<Package> {
    let enrichedData = { ...npmData };
    if (npmData.repo_url?.includes('github.com')) {
      try {
        const githubData = await this.getGitHubData(npmData.repo_url);
        enrichedData = { ...githubData, ...npmData };
      } catch (githubError) {
        console.warn(`GitHub fetch failed for ${npmData.package_name}:`, githubError.message);
      }
    }
    return this.createOrUpdatePackage(enrichedData);
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

  private deduplicateByName<T extends Partial<Package>>(packages: T[]): T[] {
    const seen = new Set<string>();
    return packages.filter((pkg) => {
      if (!pkg.package_name || seen.has(pkg.package_name)) {
        return false;
      }
      seen.add(pkg.package_name);
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
    let packageData = await this.findPackageByName(name);
    
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
      const firstResult = searchResults[0];

      if (!firstResult) {
        return null;
      }

      // If the result from search is already a full package (from DB), return it.
      // We can check for a property that only full packages have, like `package_id`.
      if ('package_id' in firstResult) {
        return firstResult as Package;
      }

      // Otherwise, it's a partial package that needs to be fully enriched.
      return this.enrichPackage(firstResult);
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