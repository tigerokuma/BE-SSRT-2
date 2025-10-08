import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { GitHubService as CommonGitHubService } from '../../common/github/github.service';

@Injectable()
export class GitHubService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commonGitHubService: CommonGitHubService
  ) {}

  async getUserRepositories(userId: string) {
    try {
      // Get user with GitHub token
      const user = await this.prisma.user.findUnique({
        where: { user_id: userId },
        select: { access_token: true, github_username: true }
      });

      if (!user || !user.access_token) {
        throw new Error('User not found or no GitHub token available');
      }

      // Fetch repositories from GitHub API
      const response = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
        headers: {
          'Authorization': `token ${user.access_token}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'SSRT-App'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('GitHub API Error:', {
          status: response.status,
          statusText: response.statusText,
          body: errorText
        });
        throw new Error(`GitHub API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const repos = await response.json();
      
      // Transform the data to include only what we need
      return repos.map((repo: any) => ({
        id: repo.id,
        name: repo.name,
        full_name: repo.full_name,
        description: repo.description,
        html_url: repo.html_url,
        clone_url: repo.clone_url,
        ssh_url: repo.ssh_url,
        private: repo.private,
        language: repo.language,
        updated_at: repo.updated_at,
        stargazers_count: repo.stargazers_count,
        forks_count: repo.forks_count
      }));

    } catch (error) {
      console.error('Error fetching GitHub repositories:', error);
      throw new Error('Failed to fetch repositories from GitHub');
    }
  }

  async getTestUserRepositories() {
    try {
      // Get the test user with GitHub token
      const user = await this.prisma.user.findUnique({
        where: { email: 'test@example.com' },
        select: { access_token: true, github_username: true }
      });

      if (!user || !user.access_token) {
        console.log('No GitHub token found, using mock data');
        return this.getMockRepositories();
      }

      console.log('Using real GitHub token to fetch repositories');
      
      // Fetch repositories from GitHub API
      const response = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
        headers: {
          'Authorization': `token ${user.access_token}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'SSRT-App'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('GitHub API Error:', {
          status: response.status,
          statusText: response.statusText,
          body: errorText
        });
        console.log('Falling back to mock data');
        return this.getMockRepositories();
      }

      const repos = await response.json();
      console.log(`✅ Successfully fetched ${repos.length} repositories from GitHub`);
      
      // Transform the data to include only what we need
      return repos.map((repo: any) => ({
        id: repo.id,
        name: repo.name,
        full_name: repo.full_name,
        description: repo.description,
        html_url: repo.html_url,
        clone_url: repo.clone_url,
        ssh_url: repo.ssh_url,
        private: repo.private,
        language: repo.language,
        updated_at: repo.updated_at,
        stargazers_count: repo.stargazers_count,
        forks_count: repo.forks_count
      }));

    } catch (error) {
      console.error('Error fetching GitHub repositories:', error);
      console.log('Falling back to mock data');
      return this.getMockRepositories();
    }
  }

  async getRepositoryBranches(repositoryUrl: string) {
    try {
      // Extract owner and repo from GitHub URL
      const match = repositoryUrl.match(/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?(?:\/.*)?$/);
      if (!match) {
        throw new Error(`Invalid GitHub repository URL: ${repositoryUrl}`);
      }

      const [, owner, repo] = match;
      console.log(`Fetching branches for: ${owner}/${repo}`);

      const octokit = await this.commonGitHubService.getAuthenticatedOctokit();
      
      const response = await octokit.repos.listBranches({
        owner,
        repo,
        per_page: 100,
      });

      const branches = response.data.map((branch: any) => ({
        name: branch.name,
        protected: branch.protected,
        commit_sha: branch.commit.sha,
        commit_url: branch.commit.url,
      }));

      console.log(`✅ Found ${branches.length} branches for ${owner}/${repo}`);
      return branches;

    } catch (error) {
      console.error('Error fetching repository branches:', error);
      // Return default branches as fallback
      return [
        { name: 'main', protected: false },
        { name: 'master', protected: false },
        { name: 'develop', protected: false },
      ];
    }
  }

  private getMockRepositories() {
    return [
      {
        id: 1,
        name: 'my-awesome-project',
        full_name: 'test-user/my-awesome-project',
        description: 'A sample project for testing',
        html_url: 'https://github.com/test-user/my-awesome-project',
        clone_url: 'https://github.com/test-user/my-awesome-project.git',
        ssh_url: 'git@github.com:test-user/my-awesome-project.git',
        private: false,
        language: 'TypeScript',
        updated_at: new Date().toISOString(),
        stargazers_count: 5,
        forks_count: 2
      },
      {
        id: 2,
        name: 'react-dashboard',
        full_name: 'test-user/react-dashboard',
        description: 'A modern React dashboard with TypeScript',
        html_url: 'https://github.com/test-user/react-dashboard',
        clone_url: 'https://github.com/test-user/react-dashboard.git',
        ssh_url: 'git@github.com:test-user/react-dashboard.git',
        private: true,
        language: 'JavaScript',
        updated_at: new Date().toISOString(),
        stargazers_count: 12,
        forks_count: 3
      },
      {
        id: 3,
        name: 'api-server',
        full_name: 'test-user/api-server',
        description: 'RESTful API server built with Node.js and Express',
        html_url: 'https://github.com/test-user/api-server',
        clone_url: 'https://github.com/test-user/api-server.git',
        ssh_url: 'git@github.com:test-user/api-server.git',
        private: false,
        language: 'JavaScript',
        updated_at: new Date().toISOString(),
        stargazers_count: 8,
        forks_count: 1
      },
      {
        id: 4,
        name: 'security-scanner',
        full_name: 'test-user/security-scanner',
        description: 'Automated security vulnerability scanner for dependencies',
        html_url: 'https://github.com/test-user/security-scanner',
        clone_url: 'https://github.com/test-user/security-scanner.git',
        ssh_url: 'git@github.com:test-user/security-scanner.git',
        private: false,
        language: 'Python',
        updated_at: new Date().toISOString(),
        stargazers_count: 25,
        forks_count: 7
      },
      {
        id: 5,
        name: 'mobile-app',
        full_name: 'test-user/mobile-app',
        description: 'Cross-platform mobile application built with React Native',
        html_url: 'https://github.com/test-user/mobile-app',
        clone_url: 'https://github.com/test-user/mobile-app.git',
        ssh_url: 'git@github.com:test-user/mobile-app.git',
        private: true,
        language: 'TypeScript',
        updated_at: new Date().toISOString(),
        stargazers_count: 3,
        forks_count: 0
      }
    ];
  }
}
