import { Test, TestingModule } from '@nestjs/testing';
import { PackagesService } from './packages.service';
import { PackageSearchService } from './package-search.service';
import { PackageCardDto, PackageDetailsDto } from '../dto/packages.dto';

describe('PackagesService', () => {
  let service: PackagesService;
  let packageSearchService: PackageSearchService;

  const mockPackageSearchService = {
    searchPackages: jest.fn(),
    getPackageDetails: jest.fn(),
    forceRefreshCache: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PackagesService,
        {
          provide: PackageSearchService,
          useValue: mockPackageSearchService,
        },
      ],
    }).compile();

    service = module.get<PackagesService>(PackagesService);
    packageSearchService = module.get<PackageSearchService>(PackageSearchService);
    
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('searchPackages', () => {
    const mockSearchData = [
      {
        package_name: 'test-package',
        description: 'A test package',
        keywords: ['test', 'utility'],
        downloads: 1000,
        maintainers: ['test@example.com'],
        last_updated: '2024-01-01T00:00:00Z',
        version: '1.0.0',
        license: 'MIT'
      },
      {
        package_name: 'another-package',
        description: 'Another test package',
        keywords: ['test'],
        downloads: 500,
        maintainers: ['test2@example.com'],
        last_updated: '2024-01-02T00:00:00Z',
        version: '2.0.0',
        license: 'ISC'
      }
    ];

    it('should return transformed package cards', async () => {
      mockPackageSearchService.searchPackages.mockResolvedValue(mockSearchData);

      const result = await service.searchPackages('test');

      expect(mockPackageSearchService.searchPackages).toHaveBeenCalledWith('test');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        name: 'test-package',
        description: 'A test package',
        keywords: ['test', 'utility'],
        downloads: 1000,
        maintainers: ['test@example.com'],
        last_updated: '2024-01-01',
        version: '1.0.0',
        license: 'MIT'
      });
    });

    it('should handle packages with missing optional fields', async () => {
      const incompletePackage = {
        package_name: 'incomplete-package',
        version: '1.0.0'
      };
      mockPackageSearchService.searchPackages.mockResolvedValue([incompletePackage]);

      const result = await service.searchPackages('incomplete');

      expect(result[0]).toEqual({
        name: 'incomplete-package',
        description: '',
        keywords: [],
        downloads: 0,
        maintainers: [],
        last_updated: '',
        version: '1.0.0',
        license: ''
      });
    });

    it('should return empty array when no packages found', async () => {
      mockPackageSearchService.searchPackages.mockResolvedValue([]);

      const result = await service.searchPackages('nonexistent');

      expect(result).toEqual([]);
    });
  });

  describe('getPackage', () => {
    const mockPackageData = {
      package_name: 'test-package',
      description: 'A test package',
      keywords: ['test'],
      downloads: 1000,
      maintainers: ['test@example.com'],
      last_updated: '2024-01-01T00:00:00Z',
      version: '1.0.0',
      license: 'MIT',
      package_id: 'pkg-123',
      published_at: new Date('2024-01-01'),
      risk_score: 2,
      npm_url: 'https://npmjs.com/package/test-package',
      repo_url: 'https://github.com/test/package',
      githubRepo: {
        repo_name: 'test/package',
        stars: 100,
        forks: 20,
        contributors: 5
      },
      homepage: 'https://test-package.com'
    };

    it('should return package card for summary view', async () => {
      mockPackageSearchService.getPackageDetails.mockResolvedValue(mockPackageData);

      const result = await service.getPackage('test-package', 'summary');

      expect(mockPackageSearchService.getPackageDetails).toHaveBeenCalledWith('test-package');
      expect(result).toEqual({
        name: 'test-package',
        description: 'A test package',
        keywords: ['test'],
        downloads: 1000,
        maintainers: ['test@example.com'],
        last_updated: '2024-01-01',
        version: '1.0.0',
        license: 'MIT'
      });
    });

    it('should return package details for details view', async () => {
      mockPackageSearchService.getPackageDetails.mockResolvedValue(mockPackageData);

      const result = await service.getPackage('test-package', 'details');

      expect(result).toEqual({
        name: 'test-package',
        description: 'A test package',
        keywords: ['test'],
        downloads: 1000,
        maintainers: ['test@example.com'],
        last_updated: '2024-01-01',
        version: '1.0.0',
        license: 'MIT',
        package_id: 'pkg-123',
        published: '2024-01-01',
        published_at: mockPackageData.published_at,
        risk_score: 2,
        npm_url: 'https://npmjs.com/package/test-package',
        repo_url: 'https://github.com/test/package',
        repo_name: 'test/package',
        homepage: 'https://test-package.com',
        stars: 100,
        forks: 20,
        contributors: 5
      });
    });

    it('should return null when package not found', async () => {
      mockPackageSearchService.getPackageDetails.mockResolvedValue(null);

      const result = await service.getPackage('nonexistent', 'summary');

      expect(result).toBeNull();
    });

    it('should handle package without GitHub data', async () => {
      const packageWithoutGitHub = {
        ...mockPackageData,
        repo_url: null,
        githubRepo: null,
        homepage: null
      };
      mockPackageSearchService.getPackageDetails.mockResolvedValue(packageWithoutGitHub);

      const result = await service.getPackage('test-package', 'details');

      expect(result).not.toHaveProperty('repo_url');
      expect(result).not.toHaveProperty('repo_name');
      expect(result).not.toHaveProperty('homepage');
      expect(result).not.toHaveProperty('stars');
    });
  });

  describe('forceRefreshCache', () => {
    it('should call packageSearchService forceRefreshCache without repo URL', async () => {
      const mockResult = { clearedCount: 5, refreshed: true };
      mockPackageSearchService.forceRefreshCache.mockResolvedValue(mockResult);

      const result = await service.forceRefreshCache();

      expect(mockPackageSearchService.forceRefreshCache).toHaveBeenCalledWith(undefined);
      expect(result).toEqual(mockResult);
    });

    it('should call packageSearchService forceRefreshCache with repo URL', async () => {
      const repoUrl = 'https://github.com/test/repo';
      const mockResult = { clearedCount: 1, refreshed: true };
      mockPackageSearchService.forceRefreshCache.mockResolvedValue(mockResult);

      const result = await service.forceRefreshCache(repoUrl);

      expect(mockPackageSearchService.forceRefreshCache).toHaveBeenCalledWith(repoUrl);
      expect(result).toEqual(mockResult);
    });

    it('should propagate errors from packageSearchService', async () => {
      const error = new Error('Cache refresh failed');
      mockPackageSearchService.forceRefreshCache.mockRejectedValue(error);

      await expect(service.forceRefreshCache()).rejects.toThrow('Cache refresh failed');
    });
  });
}); 