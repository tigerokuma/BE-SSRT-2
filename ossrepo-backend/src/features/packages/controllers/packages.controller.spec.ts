import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PackagesController } from './packages.controller';
import { PackagesService } from '../services/packages.service';

describe('PackagesController', () => {
  let controller: PackagesController;
  let service: PackagesService;

  const mockPackagesService = {
    searchPackages: jest.fn(),
    getPackage: jest.fn(),
    forceRefreshCache: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PackagesController],
      providers: [
        {
          provide: PackagesService,
          useValue: mockPackagesService,
        },
      ],
    }).compile();

    controller = module.get<PackagesController>(PackagesController);
    service = module.get<PackagesService>(PackagesService);
    
    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('searchPackages', () => {
    const mockSearchResults = [
      { name: 'test-package-1', version: '1.0.0' },
      { name: 'test-package-2', version: '2.0.0' },
    ];

    beforeEach(() => {
      // Mock Date.now to control timing
      jest.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(1100);
      jest.spyOn(console, 'log').mockImplementation();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should return search results successfully', async () => {
      mockPackagesService.searchPackages.mockResolvedValue(mockSearchResults);

      const result = await controller.searchPackages('test');

      expect(mockPackagesService.searchPackages).toHaveBeenCalledWith('test');
      expect(result).toEqual({
        query: 'test',
        results: mockSearchResults,
        count: 2,
        responseTime: '100ms'
      });
      expect(console.log).toHaveBeenCalledWith(
        'Search "test" completed in 100ms, returned 2 packages'
      );
    });

    it('should trim whitespace from package name', async () => {
      mockPackagesService.searchPackages.mockResolvedValue(mockSearchResults);

      await controller.searchPackages('  test  ');

      expect(mockPackagesService.searchPackages).toHaveBeenCalledWith('test');
    });

    it('should throw BadRequestException when name is not provided', async () => {
      await expect(controller.searchPackages('')).rejects.toThrow(
        new BadRequestException('Package name is required')
      );
      
      await expect(controller.searchPackages('   ')).rejects.toThrow(
        new BadRequestException('Package name is required')
      );

      expect(mockPackagesService.searchPackages).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when name is less than 2 characters', async () => {
      await expect(controller.searchPackages('a')).rejects.toThrow(
        new BadRequestException('Package name must be at least 2 characters')
      );

      expect(mockPackagesService.searchPackages).not.toHaveBeenCalled();
    });

    it('should return empty results when service returns empty array', async () => {
      mockPackagesService.searchPackages.mockResolvedValue([]);

      const result = await controller.searchPackages('nonexistent');

      expect(result).toEqual({
        query: 'nonexistent',
        results: [],
        count: 0,
        responseTime: '100ms'
      });
    });
  });

  describe('getPackage', () => {
    const mockPackageData = {
      name: 'test-package',
      version: '1.0.0',
      description: 'Test package description'
    };

    it('should return package with summary view by default', async () => {
      mockPackagesService.getPackage.mockResolvedValue(mockPackageData);

      const result = await controller.getPackage('test-package');

      expect(mockPackagesService.getPackage).toHaveBeenCalledWith('test-package', 'summary');
      expect(result).toEqual(mockPackageData);
    });

    it('should return package with specified view', async () => {
      mockPackagesService.getPackage.mockResolvedValue(mockPackageData);

      const result = await controller.getPackage('test-package', 'details');

      expect(mockPackagesService.getPackage).toHaveBeenCalledWith('test-package', 'details');
      expect(result).toEqual(mockPackageData);
    });

    it('should trim whitespace from package name', async () => {
      mockPackagesService.getPackage.mockResolvedValue(mockPackageData);

      await controller.getPackage('  test-package  ', 'summary');

      expect(mockPackagesService.getPackage).toHaveBeenCalledWith('test-package', 'summary');
    });

    it('should throw BadRequestException when name is not provided', async () => {
      await expect(controller.getPackage('')).rejects.toThrow(
        new BadRequestException('Package name is required')
      );
      
      await expect(controller.getPackage('   ')).rejects.toThrow(
        new BadRequestException('Package name is required')
      );

      expect(mockPackagesService.getPackage).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException for invalid view parameter', async () => {
      await expect(controller.getPackage('test-package', 'invalid' as any)).rejects.toThrow(
        new BadRequestException('View parameter must be "summary" or "details"')
      );

      expect(mockPackagesService.getPackage).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when package is not found', async () => {
      mockPackagesService.getPackage.mockResolvedValue(null);

      await expect(controller.getPackage('nonexistent-package')).rejects.toThrow(
        new NotFoundException("Package 'nonexistent-package' not found")
      );
    });

    it('should accept summary view parameter', async () => {
      mockPackagesService.getPackage.mockResolvedValue(mockPackageData);

      await controller.getPackage('test-package', 'summary');

      expect(mockPackagesService.getPackage).toHaveBeenCalledWith('test-package', 'summary');
    });

    it('should accept details view parameter', async () => {
      mockPackagesService.getPackage.mockResolvedValue(mockPackageData);

      await controller.getPackage('test-package', 'details');

      expect(mockPackagesService.getPackage).toHaveBeenCalledWith('test-package', 'details');
    });
  });

  describe('forceRefreshCache', () => {
    it('should refresh cache without repo URL', async () => {
      const mockResult = { clearedCount: 5, refreshedAt: new Date() };
      mockPackagesService.forceRefreshCache.mockResolvedValue(mockResult);

      const result = await controller.forceRefreshCache();

      expect(mockPackagesService.forceRefreshCache).toHaveBeenCalledWith(undefined);
      expect(result).toEqual({
        message: 'Cleared 5 stale cache entries',
        ...mockResult
      });
    });

    it('should refresh cache for specific repository URL', async () => {
      const repoUrl = 'https://github.com/test/repo';
      const mockResult = { clearedCount: 1, refreshedAt: new Date() };
      mockPackagesService.forceRefreshCache.mockResolvedValue(mockResult);

      const result = await controller.forceRefreshCache(repoUrl);

      expect(mockPackagesService.forceRefreshCache).toHaveBeenCalledWith(repoUrl);
      expect(result).toEqual({
        message: `Cache refreshed for repository: ${repoUrl}`,
        ...mockResult
      });
    });

    it('should handle empty string repo URL as undefined', async () => {
      const mockResult = { clearedCount: 0, refreshedAt: new Date() };
      mockPackagesService.forceRefreshCache.mockResolvedValue(mockResult);

      const result = await controller.forceRefreshCache('');

      expect(mockPackagesService.forceRefreshCache).toHaveBeenCalledWith('');
      expect(result).toEqual({
        message: 'Cleared 0 stale cache entries',
        ...mockResult
      });
    });

    it('should handle service errors gracefully', async () => {
      const error = new Error('Service error');
      mockPackagesService.forceRefreshCache.mockRejectedValue(error);

      await expect(controller.forceRefreshCache()).rejects.toThrow('Service error');
    });
  });
});
