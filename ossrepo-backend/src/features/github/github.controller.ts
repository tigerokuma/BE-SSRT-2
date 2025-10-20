// src/features/github/github.controller.ts
import { Controller, Get, Post, Query, UseInterceptors, UploadedFile, Param, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { GitHubService } from './github.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('github')
@Controller('github')
export class GitHubController {
  constructor(private readonly githubService: GitHubService) {}

  @Get('repositories/:userId')
  @ApiOperation({ summary: 'Get user repositories from GitHub' })
  @ApiResponse({ status: 200, description: 'List of user repositories' })
  async getUserRepositories(@Param('userId') userId: string) {
    if (!userId) throw new BadRequestException('userId is required');
    return this.githubService.getUserRepositoriesByUserId(userId);
  }

  @Get('branches')
  @ApiOperation({ summary: 'Get branches for a specific repository' })
  @ApiResponse({ status: 200, description: 'List of repository branches' })
  async getBranches(
    @Query('repositoryUrl') repositoryUrl: string,
    @Query('userId') userId: string,
  ) {
    if (!repositoryUrl) throw new BadRequestException('repositoryUrl is required');
    if (!userId) throw new BadRequestException('userId is required');
    return this.githubService.getRepositoryBranches(repositoryUrl, userId);
  }

  @Get('license')
  @ApiOperation({ summary: 'Get license information for a specific repository' })
  @ApiResponse({ status: 200, description: 'Repository license information' })
  async getLicense(
    @Query('repositoryUrl') repositoryUrl: string,
    @Query('userId') userId: string,
  ) {
    if (!repositoryUrl) throw new BadRequestException('repositoryUrl is required');
    if (!userId) throw new BadRequestException('userId is required');
    return this.githubService.getRepositoryLicense(repositoryUrl, userId);
  }

  @Get('language')
  @ApiOperation({ summary: 'Get primary language for a specific repository' })
  @ApiResponse({ status: 200, description: 'Repository primary language' })
  async getLanguage(
    @Query('repositoryUrl') repositoryUrl: string,
    @Query('userId') userId: string,
  ) {
    if (!repositoryUrl) throw new BadRequestException('repositoryUrl is required');
    if (!userId) throw new BadRequestException('userId is required');
    return this.githubService.getRepositoryLanguage(repositoryUrl, userId);
  }

  @Get('package-json')
  @ApiOperation({ summary: 'Check if package.json exists in repository' })
  @ApiResponse({ status: 200, description: 'Package.json existence check' })
  async checkPackageJson(
    @Query('repositoryUrl') repositoryUrl: string,
    @Query('branch') branch = 'main',
    @Query('userId') userId?: string,
  ) {
    if (!repositoryUrl) throw new BadRequestException('repositoryUrl is required');
    if (!userId) throw new BadRequestException('userId is required');
    return this.githubService.checkPackageJson(repositoryUrl, userId, branch);
  }

  @Get('package-count')
  @ApiOperation({ summary: 'Get package count from package.json' })
  @ApiResponse({ status: 200, description: 'Package count from dependencies' })
  async getPackageCount(
    @Query('repositoryUrl') repositoryUrl: string,
    @Query('branch') branch = 'main',
    @Query('userId') userId?: string,
  ) {
    if (!repositoryUrl) throw new BadRequestException('repositoryUrl is required');
    if (!userId) throw new BadRequestException('userId is required');
    return this.githubService.getPackageCount(repositoryUrl, userId, branch);
  }

  @Post('parse-package-json')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Parse uploaded package.json file' })
  @ApiResponse({ status: 200, description: 'Parsed package.json data' })
  async parsePackageJson(@UploadedFile() file: any) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.githubService.parsePackageJsonFile(file);
  }
}
