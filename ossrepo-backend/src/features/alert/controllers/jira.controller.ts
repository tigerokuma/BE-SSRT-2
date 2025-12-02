import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  Req,
  BadGatewayException,
  BadRequestException,
  InternalServerErrorException,
  UnauthorizedException,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { JiraService } from '../services/jira.service';
import { Response } from 'express';
import { JiraIssue } from '../dto/jira.dto';
import { ClerkAuthGuard } from '../../../common/guards/clerk.guard';

@Controller('jira')
export class JiraController {
  private readonly logger = new Logger(JiraController.name);

  constructor(private readonly jiraService: JiraService) {}

  @Get('connect')
  @UseGuards(ClerkAuthGuard)
  async redirectToJira(@Req() req: any, @Res() res: Response, @Query('project_id') projectId?: string) {
    // Get clerk_id from authenticated user
    const clerkId = (req.user as any)?.sub;
    if (!clerkId) {
      throw new UnauthorizedException('User not authenticated');
    }
    
    // If project_id is provided and not empty, this is a project-level connection
    // Otherwise, it's a user-level connection
    const type = projectId && projectId.trim() !== '' ? 'project' : 'user';
    // Only pass projectId if it's valid
    const validProjectId = projectId && projectId.trim() !== '' ? projectId : undefined;
    return this.jiraService.redirectToJira(res, clerkId, type, validProjectId);
  }

  @Get('oauth/callback')
  // No guard - OAuth callback comes from Atlassian, not from authenticated frontend
  // The user's clerk_id is encoded in the state parameter
  async handleOAuthCallback(@Req() req: any, @Query() query: any, @Res() res: Response) {
    // clerk_id will be extracted from state parameter in the service
    // No authentication required - this is called by Atlassian's OAuth service
    return this.jiraService.handleOAuthCallback(req, query, res);
  }

  @Get('projects')
  @UseGuards(ClerkAuthGuard)
  async getProjects(@Req() req: any, @Query('cloud_id') cloudId?: string) {
    const clerkId = (req.user as any)?.sub;
    if (!clerkId) {
      throw new UnauthorizedException('User not authenticated');
    }
    return this.jiraService.getProjects(clerkId, cloudId);
  }

  @Post('update-project')
  @UseGuards(ClerkAuthGuard)
  async updateSelectedProject(@Req() req: any, @Body() body: { project_key: string }) {
    const clerkId = (req.user as any)?.sub;
    if (!clerkId) {
      throw new UnauthorizedException('User not authenticated');
    }
    if (!body.project_key) {
      throw new BadRequestException('project_key is required');
    }
    return this.jiraService.updateSelectedProject(clerkId, body.project_key);
  }

  @Post('create-issue')
  @UseGuards(ClerkAuthGuard)
  async createIssue(@Req() req: any, @Body() body: JiraIssue) {
    const clerkId = (req.user as any)?.sub;
    if (!clerkId) {
      throw new UnauthorizedException('User not authenticated');
    }
    return this.jiraService.createIssue(clerkId, body);
  }

  @Get('user-info/:userId')
  @UseGuards(ClerkAuthGuard)
  async getUserJiraInfo(@Req() req: any, @Param('userId') userId: string) {
    // Get clerk_id from authenticated user
    const clerkId = (req.user as any)?.sub;
    if (!clerkId) {
      throw new UnauthorizedException('User not authenticated');
    }
    return this.jiraService.getUserJiraInfo(clerkId);
  }

  // Project-level endpoints
  @Get('projects/:projectId/projects')
  @UseGuards(ClerkAuthGuard)
  async getProjectsForProject(@Param('projectId') projectId: string, @Query('cloud_id') cloudId?: string) {
    return this.jiraService.getProjectsForProject(projectId, cloudId);
  }

  @Post('projects/:projectId/update-project')
  @UseGuards(ClerkAuthGuard)
  async updateSelectedProjectForProject(@Param('projectId') projectId: string, @Body() body: { project_key: string }) {
    if (!body.project_key) {
      throw new BadRequestException('project_key is required');
    }
    return this.jiraService.updateSelectedProjectForProject(projectId, body.project_key);
  }

  @Post('projects/:projectId/create-issue')
  @UseGuards(ClerkAuthGuard)
  async createIssueForProject(@Param('projectId') projectId: string, @Body() body: JiraIssue) {
    return this.jiraService.createIssueForProject(projectId, body);
  }

  @Get('projects/:projectId/status')
  @UseGuards(ClerkAuthGuard)
  async getProjectJiraStatus(@Param('projectId') projectId: string) {
    return this.jiraService.checkProjectJiraConnection(projectId);
  }

  @Post('projects/:projectId/alerts/:alertId/create-issue')
  @UseGuards(ClerkAuthGuard)
  async createIssueFromAlert(
    @Param('projectId') projectId: string,
    @Param('alertId') alertId: string,
    @Body() body?: { summary?: string; description?: string },
  ) {
    return this.jiraService.createIssueFromAlert(projectId, alertId, body);
  }
}
