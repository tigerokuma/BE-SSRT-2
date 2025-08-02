import { Injectable } from '@nestjs/common';
import { NpmPackagesRepository } from '../repositories/npm-packages.repository';
import { GitHubRepositoriesRepository } from '../repositories/github-repositories.repository';
import { NPMService } from './npm.service';
import { GitHubService } from './github.service';
import { GitHubRepository } from 'generated/prisma';
import { OsvVulnerabilityService } from './osv-vulnerability.service';

@Injectable()
export class PackageSearchService {
  constructor(
    private readonly npmRepo: NpmPackagesRepository,
    private readonly githubRepo: GitHubRepositoriesRepository,
    private readonly npmService: NPMService,
    private readonly githubService: GitHubService,
    private readonly osvVulnerabilityService: OsvVulnerabilityService
  ) {}



  async searchPackages(name: string) {
    console.log(`================== PARALLEL SEARCH: Searching for packages: ${name} ==================`);
    
    // 1. Check NPM cache first (fast path)
    const cachedPackages = await this.npmRepo.searchByName(name);
    
    // 2. Check if we have exact match with fresh data
    const exactMatch = cachedPackages.find(pkg => 
      pkg.package_name.toLowerCase() === name.toLowerCase()
    );
    
    if (exactMatch && await this.npmRepo.isDataFresh(exactMatch.fetched_at)) {
      console.log(`Found fresh exact match for "${name}" + ${cachedPackages.length - 1} related packages`);
      return cachedPackages;
    }
    
    // 3. No exact match OR stale - fetch from NPM API (fast)
    console.log(exactMatch 
      ? `Exact match "${name}" is stale - fetching fresh NPM data`
      : `No exact match for "${name}" - fetching from NPM API`
    );
    
    try {
      const npmResults = await this.npmService.searchPackages(name, 5);
      
      if (npmResults.length === 0) {
        console.log('No NPM results found - returning cached matches');
        return cachedPackages;
      }
      
      // 4. Get NPM details and cache immediately (parallel)
      const cachePromises = npmResults.map(async (searchResult) => {
        try {
          const detailsData = await this.npmService.getPackageDetails(searchResult.name);
          const npmData = this.transformNpmData(searchResult, detailsData);
          return await this.npmRepo.createOrUpdate(npmData);
        } catch (error) {
          console.warn(`Failed to cache NPM package ${searchResult.name}:`, error.message);
          return null;
        }
      });
      
      const cachedResults = await Promise.all(cachePromises);
      const validResults = cachedResults.filter(pkg => pkg !== null);
      
      // 5. Combine with existing cached packages
      const combined = [...validResults];
      for (const cached of cachedPackages) {
        const exists = combined.some(npm => 
          npm.package_name.toLowerCase() === cached.package_name.toLowerCase()
        );
        if (!exists) {
          combined.push(cached);
        }
      }
      
      // 6. Sort: exact match first, then by downloads
      const sorted = combined.sort((a, b) => {
        const aExact = a.package_name.toLowerCase() === name.toLowerCase();
        const bExact = b.package_name.toLowerCase() === name.toLowerCase();
        
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;
        
        return (b.downloads || 0) - (a.downloads || 0);
      });
      
      console.log(`Returning ${sorted.length} NPM packages (GitHub data will be fetched separately)`);
      // Fetch OSV vulnerabilities for each package (in parallel)
      const withSecurity = await Promise.all(sorted.slice(0, 10).map(async pkg => {
        const osv_vulnerabilities = await this.osvVulnerabilityService.getNpmVulnerabilities(pkg.package_name || '');
        return {
          ...pkg,
          osv_vulnerabilities
        };
      }));
      return withSecurity;
      
    } catch (error) {
      console.warn('NPM search failed:', error.message);
      return cachedPackages;
    }
  }

  async getPackageDetails(name: string) {
    console.log(`🚀 GETTING PACKAGE DETAILS: ${name}`);
    
    // 1. Get NPM data (should be cached from search)
    let npmPackage = await this.npmRepo.findByName(name);
    
    if (!npmPackage || !await this.npmRepo.isDataFresh(npmPackage.fetched_at)) {
      console.log(`NPM data for "${name}" is missing or stale - fetching from API`);
      
      // Fetch fresh NPM data
      try {
        const npmResults = await this.npmService.searchPackages(name, 1);
        if (npmResults.length > 0) {
          const detailsData = await this.npmService.getPackageDetails(npmResults[0].name);
          const npmData = this.transformNpmData(npmResults[0], detailsData);
          npmPackage = await this.npmRepo.createOrUpdate(npmData);
        }
      } catch (error) {
        console.warn(`Failed to fetch NPM data for ${name}:`, error.message);
      }
    }
    
    if (!npmPackage) {
      return null;
    }
    
    // 2. Get GitHub data (if repo URL exists) - manually fetch and combine
    let githubData: GitHubRepository | null = null;
    if (npmPackage.repo_url) {
      githubData = await this.githubRepo.findByUrl(npmPackage.repo_url);
      
      if (!githubData || !await this.githubRepo.isDataFresh(githubData.fetched_at)) {
        console.log(`GitHub data for "${npmPackage.repo_url}" is missing or stale - fetching from API`);
        
        // Fetch fresh GitHub data
        try {
          const match = npmPackage.repo_url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
          if (match) {
            const [, owner, repo] = match;
            const githubRepoData = await this.githubService.getRepositoryDetails(owner, repo);
            const transformedGithubData = this.transformGithubData(githubRepoData);
            githubData = await this.githubRepo.createOrUpdate(transformedGithubData);
          }
        } catch (error) {
          console.warn(`Failed to fetch GitHub data for ${npmPackage.repo_url}:`, error.message);
          githubData = null;
        }
      }
    }
    
    // 3. Manually combine NPM + GitHub data
    return {
      ...npmPackage,
      githubRepo: githubData
    };
  }

  async forceRefreshCache(repoUrl?: string): Promise<{ clearedCount?: number; refreshed?: boolean }> {
    if (repoUrl) {
      // Force refresh specific repository
      await this.githubRepo.forceRefresh(repoUrl);
      return { refreshed: true };
    } else {
      // Clear all stale cache entries
      const clearedCount = await this.githubRepo.clearStaleCache();
      return { clearedCount };
    }
  }

  private transformNpmData(searchData: any, detailsData: any) {
    return {
      package_name: searchData.name,
      description: searchData.description || detailsData?.description,
      version: searchData.version || detailsData?.version,
      downloads: searchData.weeklyDownloads,
      keywords: detailsData?.keywords || [],
      license: detailsData?.license,
      npm_url: `https://npm.im/${searchData.name}`,
      homepage: detailsData?.homepage,
      published_at: searchData.lastUpdated || detailsData?.lastUpdated,
      last_updated: searchData.lastUpdated || detailsData?.lastUpdated,
      maintainers: [],
      risk_score: searchData.score ? Math.round(searchData.score * 100) : null,
      repo_url: searchData.repoUrl || detailsData?.repoUrl
    };
  }

  private transformGithubData(githubRepoData: any) {
    return {
      repo_url: githubRepoData.html_url,
      repo_name: githubRepoData.full_name,
      owner: githubRepoData.owner?.login,
      stars: githubRepoData.stargazers_count,
      forks: githubRepoData.forks_count,
      contributors: githubRepoData.contributors_count || null,
      topics: githubRepoData.topics || [],
      pushed_at: new Date(githubRepoData.pushed_at),
      created_at: new Date(githubRepoData.created_at),
      updated_at: new Date(githubRepoData.updated_at),
      default_branch: githubRepoData.default_branch,
      language: githubRepoData.language
    };
  }
} 