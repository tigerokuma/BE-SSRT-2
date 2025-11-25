// src/features/github/github.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Octokit } from '@octokit/rest';
import { UserRepository } from '../user/user.repository';
import {UserService} from "../user/user.service";

@Injectable()
export class GitHubService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
  ) {}

  // ────────────────────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────────────────────

  private async getUserToken(user_id: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { user_id },
      select: { access_token: true },
    });
    return user?.access_token ?? null;
  }

  private async getUserTokenByAny(idOrClerkId: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ clerk_id: idOrClerkId }, { user_id: idOrClerkId }], // backend PK or Clerk id
      }, select: { access_token: true },
    });
    return user?.access_token ?? null;
  }

  private async getUserOctokit(user_id: string): Promise<Octokit> {
    const token = await this.getUserTokenByAny(user_id);
    if (!token) {
      throw new Error('No GitHub token available for this user');
    }
    return new Octokit({ auth: token, userAgent: 'SSRT-App' });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Repositories (current)
  // ────────────────────────────────────────────────────────────────────────────

  async getUserRepositoriesByClerkId(clerk_id: string) {
    // getUserById now handles both user_id and clerk_id thanks to the OR clause
    const user = await this.userService.getUserById(clerk_id);
    if (!user) {
      // User doesn't exist yet - return mock data instead of throwing
      // This can happen if the frontend calls before user sync completes
      console.warn(`No local user found for identifier=${clerk_id}, returning mock repositories`);
      return this.getMockRepositories();
    }
    return this.getUserRepositoriesByUserId(user.user_id);
  }

  /**
   * Return up to 100 repositories (public + private; owner + collaborator + org)
   * for the user with backend id = user_id.
   */
  async getUserRepositoriesByUserId(user_id: string) {
    try {
      const token = await this.getUserTokenByAny(user_id);
      if (!token) {
        console.log(`[GitHub] No token for user_id=${user_id}; returning mock`);
        return this.getMockRepositories();
      }

      const url =
        'https://api.github.com/user/repos?' +
        new URLSearchParams({
          per_page: '100',
          sort: 'updated',
          affiliation: 'owner,collaborator,organization_member',
          visibility: 'all',
        }).toString();

      const response = await fetch(url, {
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'SSRT-App',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('GitHub API Error:', {
          status: response.status,
          statusText: response.statusText,
          body: errorText,
        });
        return this.getMockRepositories();
      }

      const repos = (await response.json()) as any[];

      return repos.map((repo) => ({
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
        forks_count: repo.forks_count,
      }));
    } catch (err) {
      console.error('Error fetching GitHub repositories:', err);
      return this.getMockRepositories();
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Repositories (deprecated — kept for reference)
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * @deprecated Use getUserRepositoriesByUserId(user_id: string) instead.
   * This older variant mixed concerns and didn’t clearly align with the route shape.
   * Keeping it commented for now, in case you need to reference the old behavior.
   */
  // async getUserRepositories(userId: string) {
  //   try {
  //     const user = await this.prisma.user.findUnique({
  //       where: { user_id: userId },
  //       select: { access_token: true, github_username: true },
  //     });
  //
  //     if (!user || !user.access_token) {
  //       throw new Error('User not found or no GitHub token available');
  //     }
  //
  //     const response = await fetch(
  //       'https://api.github.com/user/repos?per_page=100&sort=updated',
  //       {
  //         headers: {
  //           Authorization: `token ${user.access_token}`,
  //           Accept: 'application/vnd.github.v3+json',
  //           'User-Agent': 'SSRT-App',
  //         },
  //       }
  //     );
  //
  //     if (!response.ok) {
  //       const errorText = await response.text();
  //       console.error('GitHub API Error:', {
  //         status: response.status,
  //         statusText: response.statusText,
  //         body: errorText,
  //       });
  //       throw new Error(
  //         `GitHub API error: ${response.status} ${response.statusText} - ${errorText}`
  //       );
  //     }
  //
  //     const repos = (await response.json()) as any[];
  //
  //     return repos.map((repo) => ({
  //       id: repo.id,
  //       name: repo.name,
  //       full_name: repo.full_name,
  //       description: repo.description,
  //       html_url: repo.html_url,
  //       clone_url: repo.clone_url,
  //       ssh_url: repo.ssh_url,
  //       private: repo.private,
  //       language: repo.language,
  //       updated_at: repo.updated_at,
  //       stargazers_count: repo.stargazers_count,
  //       forks_count: repo.forks_count,
  //     }));
  //   } catch (error) {
  //     console.error('Error fetching GitHub repositories:', error);
  //     throw new Error('Failed to fetch repositories from GitHub');
  //   }
  // }

  // ────────────────────────────────────────────────────────────────────────────
  // Branches / License / Language / Package helpers (user token aware)
  // ────────────────────────────────────────────────────────────────────────────

  async getRepositoryBranches(repositoryUrl: string, user_id: string) {
    try {
      const match = repositoryUrl.match(
        /github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?(?:\/.*)?$/
      );
      if (!match) throw new Error(`Invalid GitHub repository URL: ${repositoryUrl}`);
      const [, owner, repo] = match;

      const octokit = await this.getUserOctokit(user_id);
      const response = await octokit.rest.repos.listBranches({
        owner,
        repo,
        per_page: 100,
      });

      return response.data.map((b) => ({
        name: b.name,
        protected: b.protected,
        commit_sha: b.commit?.sha,
        commit_url: b.commit?.url,
      }));
    } catch (error) {
      console.error('Error fetching repository branches:', error);
      return [
        { name: 'main', protected: false },
        { name: 'master', protected: false },
        { name: 'develop', protected: false },
      ];
    }
  }

  async getRepositoryLicense(repositoryUrl: string, user_id: string) {
    try {
      const match = repositoryUrl.match(
        /github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?(?:\/.*)?$/
      );
      if (!match) throw new Error(`Invalid GitHub repository URL: ${repositoryUrl}`);
      const [, owner, repo] = match;

      const octokit = await this.getUserOctokit(user_id);
      const repoResponse = await octokit.rest.repos.get({ owner, repo });

      if (repoResponse.data.license) {
        return {
          name: repoResponse.data.license.name,
          key: repoResponse.data.license.key,
          spdx_id: repoResponse.data.license.spdx_id,
          url: repoResponse.data.license.url,
          detected: true,
        };
      }

      const candidates = [
        'LICENSE',
        'LICENSE.txt',
        'LICENSE.md',
        'LICENCE',
        'LICENCE.txt',
        'LICENCE.md',
      ];
      for (const fileName of candidates) {
        const search = await octokit.rest.search.code({
          q: `filename:${fileName} repo:${owner}/${repo}`,
          per_page: 1,
        });
        if (search.data.items.length) {
          return {
            name: 'Custom License',
            key: 'custom',
            spdx_id: null,
            url: null,
            detected: true,
            file_name: fileName,
          };
        }
      }

      return { name: 'No License', key: 'none', spdx_id: null, url: null, detected: false };
    } catch (error) {
      console.error('Error fetching repository license:', error);
      return { name: 'Unknown', key: 'unknown', spdx_id: null, url: null, detected: false };
    }
  }

  async getRepositoryLanguage(repositoryUrl: string, user_id: string) {
    try {
      const urlMatch = repositoryUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
      if (!urlMatch) throw new Error('Invalid GitHub repository URL');
      const [, owner, repo] = urlMatch;

      const octokit = await this.getUserOctokit(user_id);
      const response = await octokit.rest.repos.get({ owner, repo });

      return { language: response.data.language || 'Unknown' };
    } catch (error) {
      console.error('Error fetching repository language:', error);
      return { language: 'Unknown' };
    }
  }

  async checkPackageJson(repositoryUrl: string, user_id: string, branch = 'main') {
    try {
      const urlMatch = repositoryUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
      if (!urlMatch) throw new Error('Invalid GitHub repository URL');
      const [, owner, repo] = urlMatch;

      const octokit = await this.getUserOctokit(user_id);

      // Try root first
      try {
        const res = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: 'package.json',
          ref: branch,
        });
        if ('content' in res.data) return { exists: true };
      } catch (e: any) {
        if (e.status !== 404) throw e;
      }

      // Fallback: tree scan
      const b = await octokit.rest.repos.getBranch({ owner, repo, branch });
      const tree = await octokit.rest.git.getTree({
        owner,
        repo,
        tree_sha: b.data.commit.sha,
        recursive: 'true',
      });

      const hit = tree.data.tree.find(
        (t) => t.type === 'blob' && t.path?.endsWith('package.json')
      );
      return { exists: !!hit };
    } catch (error) {
      console.error('Error checking package.json:', error);
      return { exists: false };
    }
  }

  async getPackageCount(repositoryUrl: string, user_id: string, branch = 'main') {
    try {
      const urlMatch = repositoryUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
      if (!urlMatch) throw new Error('Invalid GitHub repository URL');
      const [, owner, repo] = urlMatch;

      const octokit = await this.getUserOctokit(user_id);

      // Try root first
      try {
        const res = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: 'package.json',
          ref: branch,
        });
        if ('content' in res.data) {
          const content = Buffer.from(res.data.content, 'base64').toString('utf8');
          const pkg = JSON.parse(content);
          return { count: Object.keys(pkg.dependencies ?? {}).length };
        }
      } catch (e: any) {
        if (e.status !== 404) throw e;
      }

      // Fallback: tree scan
      const b = await octokit.rest.repos.getBranch({ owner, repo, branch });
      const tree = await octokit.rest.git.getTree({
        owner,
        repo,
        tree_sha: b.data.commit.sha,
        recursive: 'true',
      });

      const hit = tree.data.tree.find(
        (t) => t.type === 'blob' && t.path?.endsWith('package.json')
      );
      if (!hit?.path) return { count: 0 };

      const file = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: hit.path,
        ref: branch,
      });
      if ('content' in file.data) {
        const content = Buffer.from(file.data.content, 'base64').toString('utf8');
        const pkg = JSON.parse(content);
        return { count: Object.keys(pkg.dependencies ?? {}).length };
      }
      return { count: 0 };
    } catch (error) {
      console.error('Error getting package count:', error);
      return { count: 0 };
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // File upload parser (unchanged)
  // ────────────────────────────────────────────────────────────────────────────

  async parsePackageJsonFile(file: any) {
    try {
      const text = file.buffer.toString('utf-8');
      const pkg = JSON.parse(text);
      if (!pkg.name) throw new Error('Invalid package.json file - missing name field');

      const deps = pkg.dependencies ?? {};
      const dev = pkg.devDependencies ?? {};

      return {
        name: pkg.name,
        version: pkg.version ?? '1.0.0',
        description: pkg.description ?? '',
        dependencies: deps,
        devDependencies: dev,
        scripts: pkg.scripts ?? {},
        author: pkg.author ?? '',
        license: pkg.license ?? 'MIT',
        keywords: pkg.keywords ?? [],
        repository: pkg.repository ?? null,
        engines: pkg.engines ?? {},
        dependencyCount: Object.keys(deps).length,
      };
    } catch (e) {
      console.error('Error parsing package.json file:', e);
      throw new Error("Failed to parse package.json file. Please ensure it's valid JSON.");
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Mock data
  // ────────────────────────────────────────────────────────────────────────────

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
        forks_count: 2,
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
        forks_count: 3,
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
        forks_count: 1,
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
        forks_count: 7,
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
        forks_count: 0,
      },
    ];
  }
}
