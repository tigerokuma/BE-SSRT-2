import { Controller, Get, Query, Param, BadRequestException, NotFoundException } from '@nestjs/common';
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
      throw new BadRequestException('Package name must be at least 2 characters');
    }

    return this.packagesService.searchPackages(name.trim());
  }

  @Get(':name/summary')
  async getPackageSummary(@Param('name') name: string) {
    if (!name || name.trim().length === 0) {
      throw new BadRequestException('Package name is required');
    }

    const result = await this.packagesService.getPackageSummary(name.trim());
    
    if (!result) {
      throw new NotFoundException(`Package '${name}' not found`);
    }

    return result;
  }

  @Get(':name/details')
  async getPackageDetails(@Param('name') name: string) {
    if (!name || name.trim().length === 0) {
      throw new BadRequestException('Package name is required');
    }

    const result = await this.packagesService.getPackageDetails(name.trim());
    
    if (!result) {
      throw new NotFoundException(`Package '${name}' not found`);
    }

    return result;
  }

  @Get(':name/similar')
  async getSimilarPackages(@Param('name') name: string) {
    if (!name || name.trim().length === 0) {
      throw new BadRequestException('Package name is required');
    }

    return this.packagesService.getSimilarPackages(name.trim());
  }
}