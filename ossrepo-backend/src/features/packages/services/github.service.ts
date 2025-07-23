import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class GitHubService {
  private readonly baseUrl = 'https://api.github.com';
  private readonly token = process.env.GITHUB_TOKEN;

  async searchRepositories(query: string) {
    try {
      const response = await axios.get(`${this.baseUrl}/search/repositories`, {
        params: {
          q: query,
          sort: 'stars',
          order: 'desc',
          per_page: 10
        },
        headers: this.getHeaders()
      });
      
      return response.data.items;
    } catch (error) {
      console.error('GitHub API search error:', error);
      throw new HttpException('Failed to search GitHub', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  async getRepositoryDetails(owner: string, repo: string) {
    try {
      const [repoResponse, contributors] = await Promise.all([
        axios.get(`${this.baseUrl}/repos/${owner}/${repo}`, {
          headers: this.getHeaders()
        }),
        this.getAllContributors(owner, repo)
      ]);

      return {
        ...repoResponse.data,
        contributors_count: contributors.length,
        contributors: contributors
      };
    } catch (error) {
      console.error('GitHub API details error:', error);
      throw new HttpException('Failed to get repository details', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  async getAllContributors(owner: string, repo: string) {
    try {
      const contributors: any[] = [];
      const perPage = 100;
      
      // Strategy 1: Try parallel requests for first few pages (covers most repos)
      const initialPages = 5; // Covers up to 500 contributors
      const parallelPromises = Array.from({ length: initialPages }, (_, i) => 
        this.fetchContributorPage(owner, repo, i + 1, perPage)
      );
      
      const parallelResults = await Promise.all(parallelPromises);
      let hasMorePages = false;
      
      // Process parallel results
      for (let i = 0; i < parallelResults.length; i++) {
        const pageData = parallelResults[i];
        if (pageData.length > 0) {
          contributors.push(...pageData);
          
          // If this page is full, there might be more pages
          if (pageData.length === perPage && i === parallelResults.length - 1) {
            hasMorePages = true;
          }
        }
      }
      
      // Strategy 2: If still more pages, continue sequentially
      if (hasMorePages) {
        let page = initialPages + 1;
        while (true) {
          const pageData = await this.fetchContributorPage(owner, repo, page, perPage);
          if (pageData.length === 0) break;
          
          contributors.push(...pageData);
          
          if (pageData.length < perPage) break;
          page++;
        }
      }
      
      return contributors;
    } catch (error) {
      console.error('GitHub API contributors error:', error);
      throw new HttpException('Failed to get contributors', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  private async fetchContributorPage(owner: string, repo: string, page: number, perPage: number): Promise<any[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/repos/${owner}/${repo}/contributors`, {
        params: {
          per_page: perPage,
          page: page,
          anon: 1
        },
        headers: this.getHeaders()
      });
      return response.data || [];
    } catch (error) {
      console.warn(`Failed to fetch contributors page ${page}:`, error.message);
      return [];
    }
  }

  private getHeaders() {
    return {
      'Authorization': `token ${this.token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'OSS-Repository-Backend'
    };
  }
}