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
      let page = 1;
      const perPage = 100; // Maximum allowed per page

      while (true) {
        const response = await axios.get(`${this.baseUrl}/repos/${owner}/${repo}/contributors`, {
          params: {
            per_page: perPage,
            page: page,
            anon: 1 // Include anonymous contributors
          },
          headers: this.getHeaders()
        });

        const pageContributors = response.data;
        
        if (pageContributors.length === 0) {
          break; // No more contributors
        }

        contributors.push(...pageContributors);

        // If we got less than perPage results, we've reached the end
        if (pageContributors.length < perPage) {
          break;
        }

        page++;
      }

      return contributors;
    } catch (error) {
      console.error('GitHub API contributors error:', error);
      throw new HttpException('Failed to get contributors', HttpStatus.SERVICE_UNAVAILABLE);
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