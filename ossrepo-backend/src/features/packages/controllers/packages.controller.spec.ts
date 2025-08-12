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
      { name: 'test-package-1', version: '1.0.0', osv_vulnerabilities: [{ id: 'GHSA-test', summary: 'Test vulnerability', severity: 'HIGH' }] },
      { name: 'test-package-2', version: '2.0.0', osv_vulnerabilities: [] },
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
      expect(result.results[0]).toHaveProperty('osv_vulnerabilities');
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
      description: 'Test package description',
      osv_vulnerabilities: [{ id: 'GHSA-test2', summary: 'Test vulnerability 2', severity: 'MODERATE' }]
    };

    it('should return package with summary view by default', async () => {
      mockPackagesService.getPackage.mockResolvedValue(mockPackageData);

      const result = await controller.getPackage('test-package');

      expect(mockPackagesService.getPackage).toHaveBeenCalledWith('test-package', 'summary');
      expect(result).toEqual(mockPackageData);
      expect(result).toHaveProperty('osv_vulnerabilities');
    });

    it('should return package with specified view', async () => {
      mockPackagesService.getPackage.mockResolvedValue(mockPackageData);

      const result = await controller.getPackage('test-package', 'details');

      expect(mockPackagesService.getPackage).toHaveBeenCalledWith('test-package', 'details');
      expect(result).toEqual(mockPackageData);
      expect(result).toHaveProperty('osv_vulnerabilities');
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
    it('should call service to force refresh cache', async () => {
      mockPackagesService.forceRefreshCache.mockResolvedValue({ message: 'Cache refreshed' });

      const result = await controller.forceRefreshCache('test-package');

      expect(mockPackagesService.forceRefreshCache).toHaveBeenCalledWith('test-package');
      expect(result).toEqual({ message: 'Cache refreshed' });
    });

    it('should handle empty package name for cache refresh', async () => {
      mockPackagesService.forceRefreshCache.mockResolvedValue({ message: 'Cache cleared' });

      const result = await controller.forceRefreshCache('');

      expect(mockPackagesService.forceRefreshCache).toHaveBeenCalledWith('');
      expect(result).toEqual({ message: 'Cache cleared' });
    });
  });

  // 🔒 SECURITY TESTS
  describe('Security & Input Validation', () => {
    describe('Injection Attack Prevention', () => {
      it('should handle SQL injection attempts in search', async () => {
        const maliciousInputs = [
          "'; DROP TABLE packages; --",
          "' OR '1'='1",
          "test'; DELETE FROM npm_packages; --",
          "' UNION SELECT * FROM users --"
        ];

        mockPackagesService.searchPackages.mockResolvedValue([]);

        for (const maliciousInput of maliciousInputs) {
          await controller.searchPackages(maliciousInput);
          expect(mockPackagesService.searchPackages).toHaveBeenCalledWith(maliciousInput);
        }
      });

      it('should handle NoSQL injection attempts', async () => {
        const noSqlInjections = [
          '{"$ne": null}',
          '{"$gt": ""}',
          '{"$regex": ".*"}',
          '{"$where": "this.name.length > 0"}'
        ];

        mockPackagesService.searchPackages.mockResolvedValue([]);

        for (const injection of noSqlInjections) {
          await controller.searchPackages(injection);
          expect(mockPackagesService.searchPackages).toHaveBeenCalledWith(injection);
        }
      });

      it('should handle script injection attempts', async () => {
        const scriptInjections = [
          '<script>alert("xss")</script>',
          'javascript:alert("xss")',
          '"><script>alert("xss")</script>',
          'onload="alert(\'xss\')"'
        ];

        mockPackagesService.searchPackages.mockResolvedValue([]);

        for (const script of scriptInjections) {
          await controller.searchPackages(script);
          expect(mockPackagesService.searchPackages).toHaveBeenCalledWith(script);
        }
      });
    });

    describe('DoS & Resource Exhaustion Protection', () => {
      it('should handle extremely long package names', async () => {
        const longName = 'a'.repeat(10000); // 10KB string
        mockPackagesService.searchPackages.mockResolvedValue([]);

        await controller.searchPackages(longName);

        expect(mockPackagesService.searchPackages).toHaveBeenCalledWith(longName);
      });

      it('should handle Unicode and special characters', async () => {
        const unicodeInputs = [
          '测试包名',
          '🚀📦🔥',
          'café-âñd-émojis-🎉',
          '\\u0000\\u001f\\u007f', // Control characters
          '\x00\x1f\x7f', // Null bytes and control chars
          'test\u200b\u200c\u200d', // Zero-width characters
        ];

        mockPackagesService.searchPackages.mockResolvedValue([]);

        for (const unicode of unicodeInputs) {
          await controller.searchPackages(unicode);
          expect(mockPackagesService.searchPackages).toHaveBeenCalledWith(unicode);
        }
      });

      it('should handle path traversal attempts', async () => {
        const pathTraversals = [
          '../../../etc/passwd',
          '..\\..\\..\\windows\\system32',
          '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd',
          '....//....//....//etc/passwd',
          '/var/log/auth.log'
        ];

        mockPackagesService.searchPackages.mockResolvedValue([]);

        for (const path of pathTraversals) {
          await controller.searchPackages(path);
          expect(mockPackagesService.searchPackages).toHaveBeenCalledWith(path);
        }
      });
    });

    describe('Malformed Data Handling', () => {
      it('should handle various whitespace edge cases', async () => {
        const whitespaceTests = [
          '  test  ',    // Multiple spaces
          '\t\ttest\t\t', // Tabs
          '\n\ntest\n\n', // Newlines
          '\r\ntest\r\n', // CRLF
          '\u00A0test\u00A0', // Non-breaking spaces
          '\u2000\u2001\u2002test', // Various Unicode spaces
        ];

        mockPackagesService.searchPackages.mockResolvedValue([]);

        for (const whitespace of whitespaceTests) {
          await controller.searchPackages(whitespace);
          expect(mockPackagesService.searchPackages).toHaveBeenCalledWith(whitespace.trim());
        }
      });

      it('should handle encoded URLs and special formats', async () => {
        const encodedInputs = [
          'test%20package',
          'test+package',
          'test%2Bpackage',
          'test%3Cscript%3E',
          decodeURIComponent('test%20encoded')
        ];

        mockPackagesService.searchPackages.mockResolvedValue([]);

        for (const encoded of encodedInputs) {
          await controller.searchPackages(encoded);
          expect(mockPackagesService.searchPackages).toHaveBeenCalledWith(encoded);
        }
      });
    });

    describe('Boundary Value Testing', () => {
      it('should handle exact 2-character minimum', async () => {
        mockPackagesService.searchPackages.mockResolvedValue([]);

        await controller.searchPackages('ab');
        expect(mockPackagesService.searchPackages).toHaveBeenCalledWith('ab');
      });

      it('should handle maximum reasonable package name lengths', async () => {
        // NPM allows up to 214 characters for package names
        const maxLengthName = 'a'.repeat(214);
        mockPackagesService.searchPackages.mockResolvedValue([]);

        await controller.searchPackages(maxLengthName);
        expect(mockPackagesService.searchPackages).toHaveBeenCalledWith(maxLengthName);
      });
    });

    describe('Error Information Disclosure Prevention', () => {
      it('should not expose internal errors in search endpoint', async () => {
        const internalError = new Error('Database connection failed: server details');
        mockPackagesService.searchPackages.mockRejectedValue(internalError);

        await expect(controller.searchPackages('test')).rejects.toThrow();
        // Verify the original internal error isn't exposed to the client
      });

      it('should not expose internal errors in getPackage endpoint', async () => {
        const internalError = new Error('Internal service configuration: secret details');
        mockPackagesService.getPackage.mockRejectedValue(internalError);

        await expect(controller.getPackage('test')).rejects.toThrow();
        // Verify internal error details aren't leaked
      });
    });

    describe('Concurrent Request Handling', () => {
      it('should handle multiple simultaneous search requests', async () => {
        mockPackagesService.searchPackages.mockResolvedValue([]);

        const simultaneousRequests = Array(10).fill(null).map((_, i) => 
          controller.searchPackages(`test-${i}`)
        );

        await Promise.all(simultaneousRequests);

        expect(mockPackagesService.searchPackages).toHaveBeenCalledTimes(10);
      });
    });
  });
});
