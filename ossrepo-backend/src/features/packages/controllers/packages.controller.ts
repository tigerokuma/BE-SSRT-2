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

@Controller('packages')
export class PackagesController {
  constructor(private readonly packagesService: PackagesService) {}

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
