import { Controller, Get, Query } from '@nestjs/common';
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
}
