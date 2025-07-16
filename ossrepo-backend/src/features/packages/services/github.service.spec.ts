import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { GitHubService } from './github.service';
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('GitHubService', () => {
  let service: GitHubService;

  beforeEach(async () => {
    // Mock environment variable before module creation
    process.env.GITHUB_TOKEN = 'test-token';

    const module: TestingModule = await Test.createTestingModule({
      providers: [GitHubService],
    }).compile();

    service = module.get<GitHubService>(GitHubService);
    jest.clearAllMocks();
  });

  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('searchRepositories', () => {
    const mockSearchResponse = {
      data: {
        items: [
          {
            id: 1,
            name: 'test-repo',
            full_name: 'user/test-repo',
            description: 'A test repository',
            html_url: 'https://github.com/user/test-repo',
            stargazers_count: 100,
            forks_count: 20
          },
          {
            id: 2,
            name: 'another-repo',
            full_name: 'user/another-repo',
            description: 'Another test repository',
            html_url: 'https://github.com/user/another-repo',
            stargazers_count: 50,
            forks_count: 10
          }
        ]
      }
    };

    it('should search repositories with correct parameters', async () => {
      mockedAxios.get.mockResolvedValue(mockSearchResponse);

      const result = await service.searchRepositories('test');

      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://api.github.com/search/repositories',
        {
          params: {
            q: 'test',
            sort: 'stars',
            order: 'desc',
            per_page: 10
          },
          headers: {
            'Authorization': 'token test-token',
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'OSS-Repository-Backend'
          }
        }
      );
      expect(result).toEqual(mockSearchResponse.data.items);
    });

    it('should handle search without GitHub token', async () => {
      delete process.env.GITHUB_TOKEN;
      
      // Recreate service without token
      const module: TestingModule = await Test.createTestingModule({
        providers: [GitHubService],
      }).compile();
      const serviceWithoutToken = module.get<GitHubService>(GitHubService);
      
      mockedAxios.get.mockResolvedValue(mockSearchResponse);

      await serviceWithoutToken.searchRepositories('test');

      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: {
            'Authorization': 'token undefined',
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'OSS-Repository-Backend'
          }
        })
      );
    });

    it('should throw HttpException when search fails', async () => {
      mockedAxios.get.mockRejectedValue(new Error('GitHub API Error'));

      await expect(service.searchRepositories('test')).rejects.toThrow(
        new HttpException('Failed to search GitHub', HttpStatus.SERVICE_UNAVAILABLE)
      );
    });
  });

  describe('getRepositoryDetails', () => {
    const mockRepoResponse = {
      data: {
        id: 1,
        name: 'test-repo',
        full_name: 'user/test-repo',
        description: 'A test repository',
        html_url: 'https://github.com/user/test-repo',
        stargazers_count: 100,
        forks_count: 20,
        language: 'TypeScript',
        topics: ['javascript', 'nodejs']
      }
    };

    const mockContributorsResponse = {
      data: [
        { login: 'user1', contributions: 50 },
        { login: 'user2', contributions: 30 },
        { login: 'user3', contributions: 20 }
      ]
    };

    it('should get repository details with contributors', async () => {
      mockedAxios.get.mockImplementation((url, config) => {
        if (url.includes('/repos/user/test-repo') && !url.includes('/contributors')) {
          return Promise.resolve(mockRepoResponse);
        }
        if (url.includes('/contributors')) {
          const page = config?.params?.page || 1;
          if (page <= 5) {
            return Promise.resolve(mockContributorsResponse);
          }
          return Promise.resolve({ data: [] });
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      const result = await service.getRepositoryDetails('user', 'test-repo');

      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://api.github.com/repos/user/test-repo',
        {
          headers: {
            'Authorization': 'token test-token',
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'OSS-Repository-Backend'
          }
        }
      );

      expect(result).toEqual({
        ...mockRepoResponse.data,
        contributors_count: 15, // 3 contributors × 5 pages
        contributors: expect.any(Array)
      });
    });

    it('should handle repositories with many contributors (pagination)', async () => {
      const mockPage1 = {
        data: Array(100).fill(null).map((_, i) => ({ login: `user${i}`, contributions: 10 }))
      };
      const mockPage2 = {
        data: Array(50).fill(null).map((_, i) => ({ login: `user${i + 100}`, contributions: 5 }))
      };

      mockedAxios.get.mockImplementation((url, config) => {
        if (url.includes('/repos/user/test-repo') && !url.includes('/contributors')) {
          return Promise.resolve(mockRepoResponse);
        }
        if (url.includes('/contributors')) {
          const page = config?.params?.page || 1;
          if (page <= 5) {
            if (page === 1) return Promise.resolve(mockPage1);
            if (page === 2) return Promise.resolve(mockPage1);
            if (page === 3) return Promise.resolve(mockPage1);
            if (page === 4) return Promise.resolve(mockPage1);
            if (page === 5) return Promise.resolve(mockPage2);
          }
          return Promise.resolve({ data: [] });
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      const result = await service.getRepositoryDetails('user', 'test-repo');

      expect(result.contributors_count).toBe(450); // 4×100 + 1×50
      expect(result.contributors).toHaveLength(450);
    });

    it('should handle contributor API failures gracefully', async () => {
      mockedAxios.get.mockImplementation((url) => {
        if (url.includes('/repos/user/test-repo') && !url.includes('/contributors')) {
          return Promise.resolve(mockRepoResponse);
        }
        if (url.includes('/contributors')) {
          return Promise.reject(new Error('Contributors API failed'));
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const result = await service.getRepositoryDetails('user', 'test-repo');

      expect(result.contributors_count).toBe(0);
      expect(result.contributors).toEqual([]);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to fetch contributors page 1:',
        'Contributors API failed'
      );

      consoleSpy.mockRestore();
    });

    it('should throw HttpException when repository details fail', async () => {
      mockedAxios.get.mockRejectedValue(new Error('Repository not found'));

      await expect(service.getRepositoryDetails('user', 'nonexistent')).rejects.toThrow(
        new HttpException('Failed to get repository details', HttpStatus.SERVICE_UNAVAILABLE)
      );
    });
  });

  describe('getAllContributors', () => {
    it('should get all contributors with parallel then sequential pagination', async () => {
      const mockPageData = [
        { login: 'user1', contributions: 50 },
        { login: 'user2', contributions: 30 }
      ];

      mockedAxios.get.mockImplementation((url, config) => {
        const page = config?.params?.page || 1;
        if (page <= 5) {
          return Promise.resolve({ data: mockPageData });
        }
        return Promise.resolve({ data: [] });
      });

      const result = await service.getAllContributors('user', 'test-repo');

      expect(result).toHaveLength(10); // 2 contributors × 5 parallel pages
      expect(result[0]).toEqual({ login: 'user1', contributions: 50 });

      // Should have called API 5 times in parallel initially
      expect(mockedAxios.get).toHaveBeenCalledTimes(5);
    });

    it('should handle API failures gracefully and return empty array', async () => {
      mockedAxios.get.mockRejectedValue(new Error('API Error'));

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const result = await service.getAllContributors('user', 'test-repo');

      expect(result).toEqual([]);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to fetch contributors page 1:',
        'API Error'
      );

      consoleSpy.mockRestore();
    });
  });

  describe('getHeaders', () => {
    it('should include authorization header when token is available', () => {
      const headers = service['getHeaders']();

      expect(headers).toEqual({
        'Authorization': 'token test-token',
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'OSS-Repository-Backend'
      });
    });

    it('should include authorization with undefined when token is not available', async () => {
      delete process.env.GITHUB_TOKEN;
      
      // Recreate service without token
      const module: TestingModule = await Test.createTestingModule({
        providers: [GitHubService],
      }).compile();
      const serviceWithoutToken = module.get<GitHubService>(GitHubService);

      const headers = serviceWithoutToken['getHeaders']();

      expect(headers).toEqual({
        'Authorization': 'token undefined',
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'OSS-Repository-Backend'
      });
    });
  });
}); 