import {
  Controller,
  Get,
  Query,
  Param,
  BadRequestException,
  NotFoundException,
  Delete,
} from '@nestjs/common';
import { PackagesService } from '../services/packages.service';
import { PackageVulnerabilityService } from '../../dependencies/services/package-vulnerability.service';
import { MonthlyCommitsService } from '../../dependencies/services/monthly-commits.service';

@Controller('packages')
export class PackagesController {
  constructor(
    private readonly packagesService: PackagesService,
    private readonly packageVulnerability: PackageVulnerabilityService,
    private readonly monthlyCommits: MonthlyCommitsService,
  ) {}

  @Get('search')
  async searchPackages(@Query('name') name: string) {
    if (!name || name.trim().length === 0) {
      throw new BadRequestException('Package name is required');
    }

    if (name.length < 2) {
      throw new BadRequestException(
        'Package name must be at least 2 characters',
      );
    }

    const startTime = Date.now();
    const results = await this.packagesService.searchPackages(name.trim());
    const responseTime = Date.now() - startTime;

    console.log(
      `Search "${name}" completed in ${responseTime}ms, returned ${results.length} packages`,
    );

    return {
      query: name.trim(),
      results,
      count: results.length,
      responseTime: `${responseTime}ms`,
    };
  }

  @Get('id/:id')
  async getPackageById(
    @Param('id') id: string,
    @Query('version') version?: string,
    @Query('view') view?: 'summary' | 'details',
  ) {
    if (!id || id.trim().length === 0) {
      throw new BadRequestException('Package ID is required');
    }

    // Validate view parameter
    if (view && !['summary', 'details'].includes(view)) {
      throw new BadRequestException(
        'View parameter must be "summary" or "details"',
      );
    }

    // Default to details view for dependency details screen
    const selectedView = view || 'details';

    const result = await this.packagesService.getPackageById(
      id.trim(),
      version,
      selectedView,
    );

    if (!result) {
      throw new NotFoundException(`Package with ID '${id}' not found`);
    }

    return result;
  }

  @Get(':name')
  async getPackage(
    @Param('name') name: string,
    @Query('view') view?: 'summary' | 'details',
  ) {
    if (!name || name.trim().length === 0) {
      throw new BadRequestException('Package name is required');
    }

    // Validate view parameter
    if (view && !['summary', 'details'].includes(view)) {
      throw new BadRequestException(
        'View parameter must be "summary" or "details"',
      );
    }

    // Default to summary view if no view specified
    const selectedView = view || 'summary';

    const result = await this.packagesService.getPackage(
      name.trim(),
      selectedView,
    );

    if (!result) {
      throw new NotFoundException(`Package '${name}' not found`);
    }

    return result;
  }

  @Get(':name/vulnerabilities')
  async getPackageVulnerabilities(@Param('name') name: string) {
    if (!name || name.trim().length === 0) {
      throw new BadRequestException('Package name is required');
    }

    const vulnerabilities =
      await this.packagesService.getPackageVulnerabilities(name.trim());
    return {
      package_name: name.trim(),
      vulnerabilities,
      count: vulnerabilities.length,
    };
  }

  @Get('vulnerabilities/search')
  async searchVulnerabilities(@Query('package') packageName: string) {
    if (!packageName || packageName.trim().length === 0) {
      throw new BadRequestException('Package name is required');
    }

    const vulnerabilities = await this.packagesService.searchVulnerabilities(
      packageName.trim(),
    );
    return {
      package_name: packageName.trim(),
      vulnerabilities,
      count: vulnerabilities.length,
      source: 'osv_api',
    };
  }

  @Get('dependency/:id/:version')
  async getDependencyById(
    @Param('id') id: string,
    @Param('version') version: string,
  ) {
    if (!id || id.trim().length === 0) {
      throw new BadRequestException('Package ID is required');
    }

    if (!version || version.trim().length === 0) {
      throw new BadRequestException('Version is required');
    }

    const result = await this.packagesService.getDependencyById(
      id.trim(),
      version.trim(),
    );

    if (!result) {
      throw new NotFoundException(`Dependency with ID '${id}' and version '${version}' not found`);
    }

    return result;
  }

  @Get('project/:projectId/dependency/:packageId/:version')
  async getDependencyByProjectAndPackage(
    @Param('projectId') projectId: string,
    @Param('packageId') packageId: string,
    @Param('version') version: string,
  ) {
    if (!projectId || projectId.trim().length === 0) {
      throw new BadRequestException('Project ID is required');
    }

    if (!packageId || packageId.trim().length === 0) {
      throw new BadRequestException('Package ID is required');
    }

    if (!version || version.trim().length === 0) {
      throw new BadRequestException('Version is required');
    }

    // Query the Packages table directly and return raw data
    const result = await this.packagesService.getRawPackageFromDatabase(
      packageId.trim(),
    );

    if (!result) {
      throw new NotFoundException(`Package with ID '${packageId}' not found`);
    }

    return result;
  }

  @Get(':packageId/versions')
  async getPackageVersions(
    @Param('packageId') packageId: string,
    @Query('limit') limit?: string,
  ) {
    if (!packageId || packageId.trim().length === 0) {
      throw new BadRequestException('Package ID is required');
    }

    const limitNum = limit ? parseInt(limit, 10) : 3;
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 50) {
      throw new BadRequestException('Limit must be a number between 1 and 50');
    }

    const versions = await this.packageVulnerability.getPackageVersions(
      packageId.trim(),
      limitNum,
    );

    return {
      package_id: packageId.trim(),
      versions,
      count: versions.length,
    };
  }

  @Get(':packageId/monthly-commits')
  async getMonthlyCommits(
    @Param('packageId') packageId: string,
    @Query('months') months?: string,
  ) {
    if (!packageId || packageId.trim().length === 0) {
      throw new BadRequestException('Package ID is required');
    }

    const monthsNum = months ? parseInt(months, 10) : 12;
    if (isNaN(monthsNum) || monthsNum < 1 || monthsNum > 24) {
      throw new BadRequestException('Months must be a number between 1 and 24');
    }

    const monthlyData = await this.monthlyCommits.getMonthlyCommits(
      packageId.trim(),
      monthsNum,
    );

    const trendData = await this.monthlyCommits.getCommitTrendData(
      packageId.trim(),
      monthsNum,
    );

    return {
      package_id: packageId.trim(),
      monthly_commits: monthlyData,
      trend_data: trendData,
      count: monthlyData.length,
    };
  }

  @Get(':packageId/commits')
  async getPackageCommits(
    @Param('packageId') packageId: string,
    @Query('limit') limit?: string,
  ) {
    if (!packageId || packageId.trim().length === 0) {
      throw new BadRequestException('Package ID is required');
    }

    const limitNum = limit ? parseInt(limit, 10) : 50;
    if (isNaN(limitNum) || limitNum < 1 || limitNum > 100) {
      throw new BadRequestException('Limit must be a number between 1 and 100');
    }

    const commits = await this.packagesService.getPackageCommits(
      packageId.trim(),
      limitNum,
    );

    return {
      package_id: packageId.trim(),
      commits,
      count: commits.length,
    };
  }

  @Delete('cache/refresh')
  async forceRefreshCache(@Query('repo_url') repoUrl?: string) {
    const result = await this.packagesService.forceRefreshCache(repoUrl);
    return {
      message: repoUrl
        ? `Cache refreshed for repository: ${repoUrl}`
        : `Cleared ${result.clearedCount} stale cache entries`,
      ...result,
    };
  }
}
