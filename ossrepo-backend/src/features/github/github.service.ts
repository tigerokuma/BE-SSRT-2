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
        where: { user_id: 'user-123' },
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

  async getRepositoryLicense(repositoryUrl: string) {
    try {
      // Extract owner and repo from GitHub URL
      const match = repositoryUrl.match(/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?(?:\/.*)?$/);
      if (!match) {
        throw new Error(`Invalid GitHub repository URL: ${repositoryUrl}`);
      }

      const [, owner, repo] = match;
      console.log(`Fetching license for: ${owner}/${repo}`);

      const octokit = await this.commonGitHubService.getAuthenticatedOctokit();
      
      // First try to get license info from repository details
      const repoResponse = await octokit.repos.get({
        owner,
        repo,
      });

      if (repoResponse.data.license) {
        console.log(`✅ Found license: ${repoResponse.data.license.name} (${repoResponse.data.license.key})`);
        return {
          name: repoResponse.data.license.name,
          key: repoResponse.data.license.key,
          spdx_id: repoResponse.data.license.spdx_id,
          url: repoResponse.data.license.url,
          detected: true
        };
      }

      // If no license detected in repo info, try to find LICENSE file
      try {
        const licenseFiles = ['LICENSE', 'LICENSE.txt', 'LICENSE.md', 'LICENCE', 'LICENCE.txt', 'LICENCE.md'];
        
        for (const fileName of licenseFiles) {
          try {
            // Search for the license file by name in the repository
            const searchResponse = await octokit.search.code({
              q: `filename:${fileName} repo:${owner}/${repo}`,
              per_page: 1
            });

            if (searchResponse.data.items.length > 0) {
              const licenseFile = searchResponse.data.items[0];
              console.log(`✅ Found license file: ${fileName} at ${licenseFile.path}`);
              return {
                name: 'Custom License',
                key: 'custom',
                spdx_id: null,
                url: null,
                detected: true,
                file_name: fileName
              };
            }
          } catch (fileError) {
            // File doesn't exist, try next one
            continue;
          }
        }
      } catch (licenseFileError) {
        console.log('No license files found');
      }

      console.log('No license detected');
      return {
        name: 'No License',
        key: 'none',
        spdx_id: null,
        url: null,
        detected: false
      };

    } catch (error) {
      console.error('Error fetching repository license:', error);
      return {
        name: 'Unknown',
        key: 'unknown',
        spdx_id: null,
        url: null,
        detected: false
      };
    }
  }

  async getRepositoryLanguage(repositoryUrl: string) {
    try {
      console.log('Fetching repository language for:', repositoryUrl);
      
      // Extract owner and repo from URL
      const urlMatch = repositoryUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
      if (!urlMatch) {
        throw new Error('Invalid GitHub repository URL');
      }
      
      const [, owner, repo] = urlMatch;
      
      // Use authenticated Octokit client like other endpoints
      const octokit = await this.commonGitHubService.getAuthenticatedOctokit();
      
      const response = await octokit.repos.get({
        owner,
        repo,
      });

      console.log('Repository language detected:', response.data.language);
      
      return {
        language: response.data.language || 'Unknown'
      };

    } catch (error) {
      console.error('Error fetching repository language:', error);
      return {
        language: 'Unknown'
      };
    }
  }

  async checkPackageJson(repositoryUrl: string, branch: string = 'main') {
    try {
      console.log('Checking for package.json in:', repositoryUrl, 'on branch:', branch);
      
      // Extract owner and repo from URL
      const urlMatch = repositoryUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
      if (!urlMatch) {
        throw new Error('Invalid GitHub repository URL');
      }
      
      const [, owner, repo] = urlMatch;
      
      // Use authenticated Octokit client
      const octokit = await this.commonGitHubService.getAuthenticatedOctokit();
      
      try {
        // First try to get package.json directly from the specific branch
        try {
          const response = await octokit.repos.getContent({
            owner,
            repo,
            path: 'package.json',
            ref: branch
          });

          if (response.data && 'content' in response.data) {
            console.log(`✅ Found package.json in root on branch ${branch}`);
            return { exists: true };
          }
        } catch (directError: any) {
          if (directError.status !== 404) {
            throw directError;
          }
          // File not in root, continue with search
        }

        // Use tree API instead of search API to avoid rate limits
        console.log(`Looking for package.json in ${owner}/${repo} on branch ${branch} using tree API...`);
        
        try {
          // Get the commit SHA for the branch
          const branchResponse = await octokit.repos.getBranch({
            owner,
            repo,
            branch
          });
          
          const treeResponse = await octokit.git.getTree({
            owner,
            repo,
            tree_sha: branchResponse.data.commit.sha,
            recursive: 'true'
          });
          
          const packageJsonFiles = treeResponse.data.tree.filter((item: any) => 
            item.path.includes('package.json') && item.type === 'blob'
          );
          
          if (packageJsonFiles.length > 0) {
            console.log(`✅ Found package.json via tree search: ${packageJsonFiles[0].path}`);
            return { exists: true };
          }
          
          console.log('❌ No package.json found in tree');
          return { exists: false };
        } catch (treeError: any) {
          console.log('❌ Tree search failed:', treeError.message);
          return { exists: false };
        }

      } catch (error: any) {
        console.log('❌ Error searching for package.json:', error.message);
        console.log('Error details:', error);
        return { exists: false };
      }

    } catch (error) {
      console.error('Error checking package.json:', error);
      return { exists: false };
    }
  }

  async getPackageCount(repositoryUrl: string, branch: string = 'main') {
    try {
      console.log('Getting package count for:', repositoryUrl, 'on branch:', branch);
      
      // Extract owner and repo from URL
      const urlMatch = repositoryUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
      if (!urlMatch) {
        throw new Error('Invalid GitHub repository URL');
      }
      
      const [, owner, repo] = urlMatch;
      
      // Use authenticated Octokit client
      const octokit = await this.commonGitHubService.getAuthenticatedOctokit();
      
      try {
        // First try to get package.json directly from the specific branch
        try {
          const response = await octokit.repos.getContent({
            owner,
            repo,
            path: 'package.json',
            ref: branch
          });

          if (response.data && 'content' in response.data) {
            // Decode the base64 content
            const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
            const packageJson = JSON.parse(content);
            
            // Count only production dependencies (not devDependencies)
            const dependencies = packageJson.dependencies || {};
            const devDependencies = packageJson.devDependencies || {};
            const totalCount = Object.keys(dependencies).length;
            
            console.log(`✅ Found ${totalCount} production packages in package.json on branch ${branch}`);
            console.log(`Dependencies: ${Object.keys(dependencies).length}, DevDependencies: ${Object.keys(devDependencies).length} (not counted)`);
            return { count: totalCount };
          }
        } catch (directError: any) {
          if (directError.status !== 404) {
            throw directError;
          }
          // File not in root, continue with search
        }

        // Use tree API instead of search API to avoid rate limits
        console.log(`Looking for package.json in ${owner}/${repo} on branch ${branch} using tree API...`);
        
        try {
          // Get the commit SHA for the branch
          const branchResponse = await octokit.repos.getBranch({
            owner,
            repo,
            branch
          });
          
          const treeResponse = await octokit.git.getTree({
            owner,
            repo,
            tree_sha: branchResponse.data.commit.sha,
            recursive: 'true'
          });
          
          const packageJsonFiles = treeResponse.data.tree.filter((item: any) => 
            item.path.includes('package.json') && item.type === 'blob'
          );
          
          if (packageJsonFiles.length === 0) {
            console.log('❌ No package.json files found in repository');
            return { count: 0 };
          }

          // Get the first package.json file found
          const packageJsonFile = packageJsonFiles[0];
          console.log(`✅ Found package.json at: ${packageJsonFile.path}`);

          // Get the content of the package.json file
          const contentResponse = await octokit.repos.getContent({
            owner,
            repo,
            path: packageJsonFile.path,
          });

          if (contentResponse.data && 'content' in contentResponse.data) {
            // Decode the base64 content
            const content = Buffer.from(contentResponse.data.content, 'base64').toString('utf-8');
            const packageJson = JSON.parse(content);
            
            // Count only production dependencies (not devDependencies)
            const dependencies = packageJson.dependencies || {};
            const devDependencies = packageJson.devDependencies || {};
            const totalCount = Object.keys(dependencies).length;
            
            console.log(`✅ Found ${totalCount} production packages in ${packageJsonFile.path}`);
            console.log(`Dependencies: ${Object.keys(dependencies).length}, DevDependencies: ${Object.keys(devDependencies).length} (not counted)`);
            return { count: totalCount };
          } else {
            console.log('❌ package.json content not found');
            return { count: 0 };
          }
        } catch (treeError: any) {
          console.log('❌ Tree search failed:', treeError.message);
          return { count: 0 };
        }

      } catch (error: any) {
        console.log('❌ Error searching for package.json:', error.message);
        console.log('Error details:', error);
        return { count: 0 };
      }

    } catch (error) {
      console.error('Error getting package count:', error);
      return { count: 0 };
    }
  }

  async parsePackageJsonFile(file: any) {
    try {
      // Read the file content
      const fileContent = file.buffer.toString('utf-8');
      
      // Parse the JSON using the same logic as getPackageCount
      const packageJson = JSON.parse(fileContent);
      
      // Validate it's a package.json file
      if (!packageJson.name) {
        throw new Error('Invalid package.json file - missing name field');
      }
      
      // Extract dependencies using the same logic as getPackageCount
      const dependencies = packageJson.dependencies || {};
      const devDependencies = packageJson.devDependencies || {};
      const totalCount = Object.keys(dependencies).length;
      
      console.log(`✅ Parsed package.json: ${packageJson.name}`);
      console.log(`Dependencies: ${Object.keys(dependencies).length}, DevDependencies: ${Object.keys(devDependencies).length}`);
      
      // Return the parsed data with the same structure as our existing logic
      return {
        name: packageJson.name,
        version: packageJson.version || '1.0.0',
        description: packageJson.description || '',
        dependencies: dependencies,
        devDependencies: devDependencies,
        scripts: packageJson.scripts || {},
        author: packageJson.author || '',
        license: packageJson.license || 'MIT',
        keywords: packageJson.keywords || [],
        repository: packageJson.repository || null,
        engines: packageJson.engines || {},
        // Include the count for consistency with existing API
        dependencyCount: totalCount
      };
    } catch (error) {
      console.error('Error parsing package.json file:', error);
      throw new Error('Failed to parse package.json file. Please ensure it\'s a valid JSON file.');
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
