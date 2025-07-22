import { Test, TestingModule } from '@nestjs/testing';
import { NpmPackagesRepository } from './npm-packages.repository';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { NpmPackage } from 'generated/prisma';

describe('NpmPackagesRepository', () => {
  let repository: NpmPackagesRepository;
  let prismaService: PrismaService;

  const mockPrismaService = {
    npmPackage: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NpmPackagesRepository,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    repository = module.get<NpmPackagesRepository>(NpmPackagesRepository);
    prismaService = module.get<PrismaService>(PrismaService);
    
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  describe('findByName', () => {
    const mockPackage: NpmPackage = {
      package_name: 'test-package',
      description: 'A test package',
      version: '1.0.0',
      downloads: 1000,
      keywords: ['test'],
      license: 'MIT',
      npm_url: 'https://npmjs.com/package/test-package',
      homepage: 'https://test.com',
      published_at: new Date('2024-01-01'),
      last_updated: new Date('2024-01-01'),
      maintainers: ['test@example.com'],
      risk_score: 2,
      repo_url: 'https://github.com/test/package',
      fetched_at: new Date('2024-01-01'),
    };

    it('should find package by name', async () => {
      mockPrismaService.npmPackage.findUnique.mockResolvedValue(mockPackage);

      const result = await repository.findByName('test-package');

      expect(mockPrismaService.npmPackage.findUnique).toHaveBeenCalledWith({
        where: { package_name: 'test-package' }
      });
      expect(result).toEqual(mockPackage);
    });

    it('should return null when package not found', async () => {
      mockPrismaService.npmPackage.findUnique.mockResolvedValue(null);

      const result = await repository.findByName('nonexistent-package');

      expect(result).toBeNull();
    });
  });

  describe('searchByName', () => {
    const mockPackages: NpmPackage[] = [
      {
        package_name: 'test-package-1',
        description: 'First test package',
        version: '1.0.0',
        downloads: 2000,
        keywords: ['test'],
        license: 'MIT',
        npm_url: 'https://npmjs.com/package/test-package-1',
        homepage: null,
        published_at: new Date('2024-01-01'),
        last_updated: new Date('2024-01-01'),
        maintainers: ['test1@example.com'],
        risk_score: 1,
        repo_url: 'https://github.com/test/package-1',
        fetched_at: new Date('2024-01-01'),
      },
      {
        package_name: 'test-package-2',
        description: 'Second test package',
        version: '2.0.0',
        downloads: 1000,
        keywords: ['test', 'utility'],
        license: 'ISC',
        npm_url: 'https://npmjs.com/package/test-package-2',
        homepage: 'https://test2.com',
        published_at: new Date('2024-01-02'),
        last_updated: new Date('2024-01-02'),
        maintainers: ['test2@example.com'],
        risk_score: 3,
        repo_url: null,
        fetched_at: new Date('2024-01-02'),
      }
    ];

    it('should search packages by name with correct query', async () => {
      mockPrismaService.npmPackage.findMany.mockResolvedValue(mockPackages);

      const result = await repository.searchByName('test');

      expect(mockPrismaService.npmPackage.findMany).toHaveBeenCalledWith({
        where: {
          package_name: { contains: 'test', mode: 'insensitive' }
        },
        orderBy: [
          { downloads: 'desc' },
          { fetched_at: 'desc' }
        ],
        take: 10
      });
      expect(result).toEqual(mockPackages);
    });

    it('should return empty array when no packages match', async () => {
      mockPrismaService.npmPackage.findMany.mockResolvedValue([]);

      const result = await repository.searchByName('nonexistent');

      expect(result).toEqual([]);
    });

    it('should handle case-insensitive search', async () => {
      await repository.searchByName('TEST');

      expect(mockPrismaService.npmPackage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            package_name: { contains: 'TEST', mode: 'insensitive' }
          }
        })
      );
    });
  });

  describe('createOrUpdate', () => {
    const mockPackageData = {
      package_name: 'test-package',
      description: 'A test package',
      version: '1.0.0',
      downloads: 1000,
      keywords: ['test'],
      license: 'MIT',
      npm_url: 'https://npmjs.com/package/test-package',
      homepage: 'https://test.com',
      published_at: new Date('2024-01-01'),
      last_updated: new Date('2024-01-01'),
      maintainers: ['test@example.com'],
      risk_score: 2,
      repo_url: 'https://github.com/test/package',
    };

    const expectedUpsertResult: NpmPackage = {
      ...mockPackageData,
      fetched_at: expect.any(Date),
    };

    it('should create new package when it does not exist', async () => {
      mockPrismaService.npmPackage.upsert.mockResolvedValue(expectedUpsertResult);

      const result = await repository.createOrUpdate(mockPackageData);

      expect(mockPrismaService.npmPackage.upsert).toHaveBeenCalledWith({
        where: { package_name: 'test-package' },
        update: {
          description: mockPackageData.description,
          version: mockPackageData.version,
          downloads: mockPackageData.downloads,
          keywords: mockPackageData.keywords,
          license: mockPackageData.license,
          npm_url: mockPackageData.npm_url,
          homepage: mockPackageData.homepage,
          published_at: mockPackageData.published_at,
          last_updated: mockPackageData.last_updated,
          maintainers: mockPackageData.maintainers,
          risk_score: mockPackageData.risk_score,
          repo_url: mockPackageData.repo_url,
          fetched_at: expect.any(Date)
        },
        create: {
          package_name: 'test-package',
          description: mockPackageData.description,
          version: mockPackageData.version,
          downloads: mockPackageData.downloads,
          keywords: mockPackageData.keywords,
          license: mockPackageData.license,
          npm_url: mockPackageData.npm_url,
          homepage: mockPackageData.homepage,
          published_at: mockPackageData.published_at,
          last_updated: mockPackageData.last_updated,
          maintainers: mockPackageData.maintainers,
          risk_score: mockPackageData.risk_score,
          repo_url: mockPackageData.repo_url,
          fetched_at: expect.any(Date)
        }
      });
      expect(result).toEqual(expectedUpsertResult);
    });

    it('should update existing package', async () => {
      const updatedData = {
        ...mockPackageData,
        version: '1.1.0',
        downloads: 2000,
      };

      mockPrismaService.npmPackage.upsert.mockResolvedValue({
        ...expectedUpsertResult,
        version: '1.1.0',
        downloads: 2000,
      });

      const result = await repository.createOrUpdate(updatedData);

      expect(mockPrismaService.npmPackage.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            version: '1.1.0',
            downloads: 2000,
          })
        })
      );
      expect(result.version).toBe('1.1.0');
      expect(result.downloads).toBe(2000);
    });

    it('should handle packages with minimal data', async () => {
      const minimalData = {
        package_name: 'minimal-package',
      };

      mockPrismaService.npmPackage.upsert.mockResolvedValue({
        package_id: 'pkg-minimal',
        package_name: 'minimal-package',
        description: null,
        version: null,
        downloads: null,
        keywords: [],
        license: null,
        npm_url: null,
        homepage: null,
        published_at: null,
        last_updated: null,
        maintainers: [],
        risk_score: null,
        repo_url: null,
        fetched_at: expect.any(Date),
      });

      await repository.createOrUpdate(minimalData);

      expect(mockPrismaService.npmPackage.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            package_name: 'minimal-package',
            keywords: [],
            maintainers: [],
          })
        })
      );
    });
  });

  describe('isDataFresh', () => {
    it('should return true for fresh data (within 12 hours)', async () => {
      const recentDate = new Date(Date.now() - 11 * 60 * 60 * 1000); // 11 hours ago

      const result = await repository.isDataFresh(recentDate);

      expect(result).toBe(true);
    });

    it('should return false for stale data (older than 12 hours)', async () => {
      const oldDate = new Date(Date.now() - 13 * 60 * 60 * 1000); // 13 hours ago

      const result = await repository.isDataFresh(oldDate);

      expect(result).toBe(false);
    });

    it('should return false for data exactly 12 hours old (boundary condition)', async () => {
      const exactlyTwelveHours = new Date(Date.now() - 12 * 60 * 60 * 1000); // exactly 12 hours ago

      const result = await repository.isDataFresh(exactlyTwelveHours);

      expect(result).toBe(false);
    });

    it('should return false for null date', async () => {
      const result = await repository.isDataFresh(null);

      expect(result).toBe(false);
    });

    it('should return false for undefined date', async () => {
      const result = await repository.isDataFresh(undefined as any);

      expect(result).toBe(false);
    });
  });


}); 