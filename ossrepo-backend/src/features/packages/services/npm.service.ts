import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class NPMService {
  private readonly npmRegistryUrl = 'https://registry.npmjs.org';
  private readonly npmSearchUrl = 'https://registry.npmjs.com/-/v1/search';
  private readonly npmDownloadsUrl = 'https://api.npmjs.org/downloads';

  async searchPackages(query: string, limit: number = 10) {
    try {
      const response = await axios.get(this.npmSearchUrl, {
        params: {
          text: query,
          size: limit,
          quality: 0.5, // Prioritize quality packages
          popularity: 0.3, // Some weight to popularity
          maintenance: 0.2, // Some weight to maintenance
        },
      });

      // Get basic search results
      const searchResults = response.data.objects.map((item) => ({
        name: item.package.name,
        description: item.package.description,
        version: item.package.version,
        npmUrl: `https://www.npmjs.com/package/${item.package.name}`,
        repoUrl: this.extractGitHubUrl(item.package.links?.repository),
        lastUpdated: new Date(item.package.date),
        score: item.score.final,
      }));

      // Fetch download statistics for all packages in parallel
      const downloadPromises = searchResults.map(async (pkg) => {
        try {
          const downloads = await this.getWeeklyDownloads(pkg.name);
          return { ...pkg, weeklyDownloads: downloads };
        } catch (error) {
          console.warn(
            `Failed to get downloads for ${pkg.name}:`,
            error.message,
          );
          return { ...pkg, weeklyDownloads: null };
        }
      });

      return await Promise.all(downloadPromises);
    } catch (error) {
      console.error('NPM Registry search error:', error);
      throw new HttpException(
        'Failed to search NPM registry',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  async getPackageDetails(packageName: string) {
    try {
      const response = await axios.get(`${this.npmRegistryUrl}/${packageName}`);
      const data = response.data;

      return {
        name: data.name,
        description: data.description,
        version: data['dist-tags']?.latest,
        repoUrl: this.extractGitHubUrl(data.repository?.url),
        homepage: data.homepage,
        keywords: data.keywords || [],
        lastUpdated: new Date(data.time?.[data['dist-tags']?.latest]),
        license: data.license,
      };
    } catch (error) {
      console.error('NPM package details error:', error);
      return null;
    }
  }

  async getWeeklyDownloads(packageName: string): Promise<number | null> {
    try {
      const response = await axios.get(
        `${this.npmDownloadsUrl}/point/last-week/${encodeURIComponent(packageName)}`,
      );
      return response.data.downloads || null;
    } catch (error) {
      // Don't log every download error as it's non-critical
      return null;
    }
  }

  private extractGitHubUrl(repoUrl: string): string | null {
    if (!repoUrl) return null;

    // Handle various GitHub URL formats
    const match = repoUrl.match(/github\.com[\/:]([^\/]+\/[^\/]+)/);
    return match ? `https://github.com/${match[1].replace('.git', '')}` : null;
  }
}
