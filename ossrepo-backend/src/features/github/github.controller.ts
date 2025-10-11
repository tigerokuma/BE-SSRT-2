import { Controller, Get, Post, Query, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { GitHubService } from './github.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('github')
@Controller('github')
export class GitHubController {
  constructor(private readonly githubService: GitHubService) {}

  @Get('repositories')
  @ApiOperation({ summary: 'Get user repositories from GitHub' })
  @ApiResponse({ status: 200, description: 'List of user repositories' })
  async getUserRepositories() {
    return await this.githubService.getTestUserRepositories();
  }

  @Get('branches')
  @ApiOperation({ summary: 'Get branches for a specific repository' })
  @ApiResponse({ status: 200, description: 'List of repository branches' })
  async getBranches(@Query('repositoryUrl') repositoryUrl: string) {
    if (!repositoryUrl) {
      throw new Error('Repository URL is required');
    }
    return await this.githubService.getRepositoryBranches(repositoryUrl);
  }

  @Get('license')
  @ApiOperation({ summary: 'Get license information for a specific repository' })
  @ApiResponse({ status: 200, description: 'Repository license information' })
  async getLicense(@Query('repositoryUrl') repositoryUrl: string) {
    if (!repositoryUrl) {
      throw new Error('Repository URL is required');
    }
    return await this.githubService.getRepositoryLicense(repositoryUrl);
  }

  @Get('language')
  @ApiOperation({ summary: 'Get primary language for a specific repository' })
  @ApiResponse({ status: 200, description: 'Repository primary language' })
  async getLanguage(@Query('repositoryUrl') repositoryUrl: string) {
    if (!repositoryUrl) {
      throw new Error('Repository URL is required');
    }
    return await this.githubService.getRepositoryLanguage(repositoryUrl);
  }

  @Get('package-json')
  @ApiOperation({ summary: 'Check if package.json exists in repository' })
  @ApiResponse({ status: 200, description: 'Package.json existence check' })
  async checkPackageJson(@Query('repositoryUrl') repositoryUrl: string, @Query('branch') branch: string = 'main') {
    if (!repositoryUrl) {
      throw new Error('Repository URL is required');
    }
    return await this.githubService.checkPackageJson(repositoryUrl, branch);
  }

  @Get('package-count')
  @ApiOperation({ summary: 'Get package count from package.json' })
  @ApiResponse({ status: 200, description: 'Package count from dependencies' })
  async getPackageCount(@Query('repositoryUrl') repositoryUrl: string, @Query('branch') branch: string = 'main') {
    if (!repositoryUrl) {
      throw new Error('Repository URL is required');
    }
    return await this.githubService.getPackageCount(repositoryUrl, branch);
  }

  @Post('parse-package-json')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Parse uploaded package.json file' })
  @ApiResponse({ status: 200, description: 'Parsed package.json data' })
  async parsePackageJson(@UploadedFile() file: any) {
    if (!file) {
      throw new Error('No file uploaded');
    }
    return await this.githubService.parsePackageJsonFile(file);
  }
}
