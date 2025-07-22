
import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, HttpStatus } from '@nestjs/common';
import { NPMService } from './npm.service';
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('NPMService', () => {
  let service: NPMService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NPMService],
    }).compile();

    service = module.get<NPMService>(NPMService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('searchPackages', () => {
    const mockSearchResponse = {
      data: {
        objects: [
          {
            package: {
              name: 'test-package',
              description: 'A test package',
              version: '1.0.0',
              date: '2024-01-01T00:00:00Z',
              links: {
                repository: 'https://github.com/test/repo'
              }
            },
            score: {
              final: 0.85
            }
          },
          {
            package: {
              name: 'another-package',
              description: 'Another test package',
              version: '2.0.0',
              date: '2024-01-02T00:00:00Z',
              links: {
                repository: 'git+https://github.com/test/another.git'
              }
            },
            score: {
              final: 0.75
            }
          }
        ]
      }
    };

    const mockDownloadsResponse = {
      data: {
        downloads: 1000
      }
    };

    beforeEach(() => {
      // Mock search API call
      mockedAxios.get.mockImplementation((url, config) => {
        if (url.includes('search')) {
          return Promise.resolve(mockSearchResponse);
        }
        // Mock downloads API call
        if (url.includes('downloads')) {
          return Promise.resolve(mockDownloadsResponse);
        }
        return Promise.reject(new Error('Unknown URL'));
      });
    });

    it('should search packages with correct parameters', async () => {
      const result = await service.searchPackages('test', 5);

      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://registry.npmjs.com/-/v1/search',
        {
          params: {
            text: 'test',
            size: 5,
            quality: 0.5,
            popularity: 0.3,
            maintenance: 0.2
          }
        }
      );
      expect(result).toHaveLength(2);
    });

    it('should return formatted search results with download stats', async () => {
      const result = await service.searchPackages('test');

      expect(result[0]).toEqual({
        name: 'test-package',
        description: 'A test package',
        version: '1.0.0',
        npmUrl: 'https://www.npmjs.com/package/test-package',
        repoUrl: 'https://github.com/test/repo',
        lastUpdated: new Date('2024-01-01T00:00:00Z'),
        score: 0.85,
        weeklyDownloads: 1000
      });
    });

    it('should extract GitHub URLs correctly', async () => {
      const result = await service.searchPackages('test');

      expect(result[0].repoUrl).toBe('https://github.com/test/repo');
      expect(result[1].repoUrl).toBe('https://github.com/test/another');
    });

    it('should handle packages without repository links', async () => {
      const responseWithoutRepo = {
        data: {
          objects: [{
            package: {
              name: 'no-repo-package',
              description: 'Package without repo',
              version: '1.0.0',
              date: '2024-01-01T00:00:00Z',
              links: {}
            },
            score: { final: 0.5 }
          }]
        }
      };

      mockedAxios.get.mockImplementation((url) => {
        if (url.includes('search')) {
          return Promise.resolve(responseWithoutRepo);
        }
        if (url.includes('downloads')) {
          return Promise.resolve(mockDownloadsResponse);
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      const result = await service.searchPackages('test');

      expect(result[0].repoUrl).toBeNull();
    });

    it('should handle download API failures gracefully', async () => {
      mockedAxios.get.mockImplementation((url) => {
        if (url.includes('search')) {
          return Promise.resolve(mockSearchResponse);
        }
        if (url.includes('downloads')) {
          return Promise.reject(new Error('Downloads API failed'));
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      const result = await service.searchPackages('test');

      expect(result[0].weeklyDownloads).toBeNull();
      // Note: getWeeklyDownloads handles errors silently and returns null,
      // so no console.warn is called in searchPackages
    });

    it('should use default limit of 10 when not specified', async () => {
      await service.searchPackages('test');

      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.stringContaining('search'),
        expect.objectContaining({
          params: expect.objectContaining({
            size: 10
          })
        })
      );
    });

    it('should throw HttpException when search API fails', async () => {
      mockedAxios.get.mockRejectedValue(new Error('NPM API Error'));

      await expect(service.searchPackages('test')).rejects.toThrow(
        new HttpException('Failed to search NPM registry', HttpStatus.SERVICE_UNAVAILABLE)
      );
    });
  });

  describe('getPackageDetails', () => {
    const mockPackageResponse = {
      data: {
        name: 'test-package',
        description: 'A test package',
        'dist-tags': { latest: '1.0.0' },
        repository: {
          type: 'git',
          url: 'https://github.com/test/repo'
        },
        homepage: 'https://test-package.com',
        keywords: ['test', 'utility'],
        license: 'MIT',
        time: {
          created: '2024-01-01T00:00:00Z',
          modified: '2024-01-01T00:00:00Z',
          '1.0.0': '2024-01-01T00:00:00Z'
        }
      }
    };

    it('should get package details successfully', async () => {
      mockedAxios.get.mockResolvedValue(mockPackageResponse);

      const result = await service.getPackageDetails('test-package');

      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://registry.npmjs.org/test-package'
      );
      expect(result).toEqual({
        name: 'test-package',
        description: 'A test package',
        version: '1.0.0',
        keywords: ['test', 'utility'],
        license: 'MIT',
        repoUrl: 'https://github.com/test/repo',
        homepage: 'https://test-package.com',
        lastUpdated: new Date('2024-01-01T00:00:00Z')
      });
    });

    it('should handle packages without optional fields', async () => {
      const minimalResponse = {
        data: {
          name: 'minimal-package',
          'dist-tags': { latest: '1.0.0' },
          time: {
            created: '2024-01-01T00:00:00Z',
            modified: '2024-01-01T00:00:00Z',
            '1.0.0': '2024-01-01T00:00:00Z'
          }
        }
      };

      mockedAxios.get.mockResolvedValue(minimalResponse);

      const result = await service.getPackageDetails('minimal-package');

      expect(result).toBeDefined();
      expect(result!.description).toBeUndefined();
      expect(result!.keywords).toEqual([]);
      expect(result!.license).toBeUndefined();
      expect(result!.repoUrl).toBeNull();
      expect(result!.homepage).toBeUndefined();
    });

    it('should return null when API fails', async () => {
      mockedAxios.get.mockRejectedValue(new Error('Package not found'));

      const result = await service.getPackageDetails('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getWeeklyDownloads', () => {
    it('should get weekly downloads successfully', async () => {
      const mockResponse = {
        data: {
          downloads: 5000
        }
      };

      mockedAxios.get.mockResolvedValue(mockResponse);

      const result = await service.getWeeklyDownloads('test-package');

      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://api.npmjs.org/downloads/point/last-week/test-package'
      );
      expect(result).toBe(5000);
    });

    it('should return null when downloads data is not available', async () => {
      const mockResponse = {
        data: {}
      };

      mockedAxios.get.mockResolvedValue(mockResponse);

      const result = await service.getWeeklyDownloads('test-package');

      expect(result).toBeNull();
    });

    it('should return null when API fails', async () => {
      mockedAxios.get.mockRejectedValue(new Error('Downloads API error'));

      const result = await service.getWeeklyDownloads('test-package');

      expect(result).toBeNull();
    });
  });

  describe('extractGitHubUrl', () => {
    it('should extract GitHub URL from various formats', () => {
      // Test direct GitHub URL
      expect(service['extractGitHubUrl']('https://github.com/user/repo')).toBe('https://github.com/user/repo');
      
      // Test git+https format
      expect(service['extractGitHubUrl']('git+https://github.com/user/repo.git')).toBe('https://github.com/user/repo');
      
      // Test git format
      expect(service['extractGitHubUrl']('git://github.com/user/repo.git')).toBe('https://github.com/user/repo');
      
      // Test SSH format
      expect(service['extractGitHubUrl']('git@github.com:user/repo.git')).toBe('https://github.com/user/repo');
    });

    it('should return null for non-GitHub URLs', () => {
      expect(service['extractGitHubUrl']('https://gitlab.com/user/repo')).toBeNull();
      expect(service['extractGitHubUrl']('https://bitbucket.org/user/repo')).toBeNull();
      expect(service['extractGitHubUrl']('')).toBeNull();
      expect(service['extractGitHubUrl'](null as any)).toBeNull();
      expect(service['extractGitHubUrl'](undefined as any)).toBeNull();
    });
  });
}); 