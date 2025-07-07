import { Controller, Get, Query, Param } from '@nestjs/common';
import { PackagesService } from '../services/packages.service';

@Controller('packages')
export class PackagesController {
  constructor(private readonly packagesService: PackagesService) {}

  @Get('search')
  async searchPackages(@Query('name') name: string) {
    // TODO: Implement package search functionality
    return this.packagesService.searchPackages(name);
  }

  @Get(':name/summary')
  async getPackageSummary(@Param('name') name: string) {
    // TODO: Implement package summary retrieval
    return this.packagesService.getPackageSummary(name);
  }

  @Get(':name/details')
  async getPackageDetails(@Param('name') name: string) {
    // TODO: Implement detailed package metadata retrieval
    return this.packagesService.getPackageDetails(name);
  }

  @Get(':name/similar')
  async getSimilarPackages(@Param('name') name: string) {
    // TODO: Implement similar packages recommendation
    return this.packagesService.getSimilarPackages(name);
  }
} 