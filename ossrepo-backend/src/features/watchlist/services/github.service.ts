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
          per_page: 10,
        },
        headers: this.getHeaders(),
      });

      return response.data.items;
    } catch (error) {
      console.error('GitHub API search error:', error);
      throw new HttpException(
        'Failed to search GitHub',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  async getRepositoryDetails(owner: string, repo: string) {
    try {
      const [repoResponse, contributorsResponse] = await Promise.all([
        axios.get(`${this.baseUrl}/repos/${owner}/${repo}`, {
          headers: this.getHeaders(),
        }),
        axios.get(`${this.baseUrl}/repos/${owner}/${repo}/contributors`, {
          params: { per_page: 1 }, // Just get count
          headers: this.getHeaders(),
        }),
      ]);

      return {
        ...repoResponse.data,
        contributors_count: contributorsResponse.data.length,
      };
    } catch (error) {
      console.error('GitHub API details error:', error);
      throw new HttpException(
        'Failed to get repository details',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  private getHeaders() {
    return {
      Authorization: `token ${this.token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'OSS-Repository-Backend',
    };
  }
}
