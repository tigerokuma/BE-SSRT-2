import {
  Controller,
  Get,
  Query,
  Param,
  BadRequestException,
  NotFoundException,
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
}
