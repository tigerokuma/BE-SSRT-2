import { Controller, Post, Get, Body, Param } from '@nestjs/common';
import { ProjectService } from '../services/project.service';
import { CreateProjectDto } from '../dto/create-project.dto';

@Controller('projects')
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  @Post()
  async createProject(@Body() createProjectDto: CreateProjectDto) {
    return this.projectService.createProject(createProjectDto);
  }

  @Get('user/:userId')
  async getProjectsByUserId(@Param('userId') userId: string) {
    return this.projectService.getProjectsByUserId(userId);
  }

  @Get(':id')
  async getProjectById(@Param('id') id: string) {
    return this.projectService.getProjectById(id);
  }

  @Get(':id/users')
  async getProjectUsers(@Param('id') id: string) {
    return this.projectService.getProjectUsers(id);
  }

  @Get(':id/dependencies')
  async getProjectDependencies(@Param('id') id: string) {
    return this.projectService.getProjectDependencies(id);
  }

  @Get(':id/watchlist')
  async getWatchlistDependencies(@Param('id') id: string) {
    return this.projectService.getWatchlistDependencies(id);
  }

  @Post(':id/refresh-dependencies')
  async refreshProjectDependencies(@Param('id') id: string) {
    return this.projectService.refreshProjectDependencies(id);
  }

  @Get(':id/user/:userId/role')
  async getUserRoleInProject(@Param('id') id: string, @Param('userId') userId: string) {
    const role = await this.projectService.getUserRoleInProject(id, userId);
    return { role };
  }

  @Post(':id/join')
  async joinProject(@Param('id') id: string) {
    return this.projectService.joinProject(id);
  }

  @Post(':id/watchlist')
  async addToProjectWatchlist(
    @Param('id') id: string,
    @Body() body: { userId: string; repoUrl: string; name: string }
  ) {
    return this.projectService.addToProjectWatchlist(id, body.userId, body.repoUrl, body.name);
  }

  @Get(':id/project-watchlist')
  async getProjectWatchlist(@Param('id') id: string) {
    return this.projectService.getProjectWatchlist(id);
  }

  @Get('watchlist/:watchlistId/review')
  async getProjectWatchlistReview(@Param('watchlistId') watchlistId: string) {
    return this.projectService.getProjectWatchlistReview(watchlistId);
  }

  @Post('watchlist/:watchlistId/approve')
  async addApproval(
    @Param('watchlistId') watchlistId: string,
    @Body() body: { userId: string }
  ) {
    return this.projectService.addApproval(watchlistId, body.userId);
  }

  @Post('watchlist/:watchlistId/disapprove')
  async addDisapproval(
    @Param('watchlistId') watchlistId: string,
    @Body() body: { userId: string }
  ) {
    return this.projectService.addDisapproval(watchlistId, body.userId);
  }

  @Post('watchlist/:watchlistId/comment')
  async addComment(
    @Param('watchlistId') watchlistId: string,
    @Body() body: { userId: string; comment: string }
  ) {
    return this.projectService.addComment(watchlistId, body.userId, body.comment);
  }
}
