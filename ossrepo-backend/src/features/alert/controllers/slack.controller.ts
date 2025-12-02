import {
  Controller,
  Get,
  Post,
  Res,
  Body,
  Query,
  Param,
  Req,
  Logger,
  BadGatewayException,
  BadRequestException,
  InternalServerErrorException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { SlackService } from '../services/slack.service';
import { SlackOauthConnect, UserChannel, UserMessage } from '../dto/slack.dto';
import { Response } from 'express';
import { ClerkAuthGuard } from '../../../common/guards/clerk.guard';

@Controller('slack')
export class SlackController {
  private readonly logger = new Logger(SlackController.name);

  constructor(private readonly slackService: SlackService) {}

  @Get('connect')
  @UseGuards(ClerkAuthGuard)
  async redirectToSlack(@Req() req: any, @Res() res: Response, @Query('project_id') projectId?: string) {
    // Get clerk_id from authenticated user
    const clerkId = (req.user as any)?.sub;
    if (!clerkId) {
      throw new UnauthorizedException('User not authenticated');
    }
    
    // If project_id is provided, this is a project-level connection
    // Otherwise, it's a user-level connection
    const type = projectId ? 'project' : 'user';
    return this.slackService.redirectToSlack(res, clerkId, type, projectId);
  }

  @Get('oauth/callback')
  // No guard - OAuth callback comes from Slack, not from authenticated frontend
  // The user's clerk_id is encoded in the state parameter
  async handleOAuthCallback(@Req() req: any, @Query() query: any, @Res() res: Response) {
    // clerk_id will be extracted from state parameter in the service
    // No authentication required - this is called by Slack's OAuth service
    return this.slackService.handleOAuthCallback(req, query, res);
  }

  @Get('channels')
  @UseGuards(ClerkAuthGuard)
  async listChannels(@Req() req: any) {
    const clerkId = (req.user as any)?.sub;
    if (!clerkId) {
      throw new UnauthorizedException('User not authenticated');
    }
    try {
      return await this.slackService.getChannels(clerkId);
    } catch (err) {
      this.logger.error('Slack listChannels error:', err.stack);

      if (err.response?.data?.error === 'invalid_auth') {
        throw new UnauthorizedException('Invalid Slack credentials');
      }

      throw new BadGatewayException('Failed to fetch Slack channels');
    }
  }

  @Post('send-message')
  async sendMessage(@Body() userMessage: UserMessage) {
    if (!userMessage) {
      this.logger.warn('sendMessage called without userMessage body');
      throw new BadRequestException('Missing message body');
    }
    try {
      await this.slackService.sendMessage(userMessage);
      return { success: true, message: 'Message sent to Slack successfully' };
    } catch (err) {
      this.logger.error('Failed to send Slack message', err.stack);
      throw new BadGatewayException('Failed to send Slack message');
    }
  }

  @Post('update-channel')
  @UseGuards(ClerkAuthGuard)
  async updateSelectedChannel(@Req() req: any, @Body() body: { channel_id: string }) {
    const clerkId = (req.user as any)?.sub;
    if (!clerkId) {
      throw new UnauthorizedException('User not authenticated');
    }
    if (!body.channel_id) {
      throw new BadRequestException('channel_id is required');
    }
    return this.slackService.updateSelectedChannel(clerkId, body.channel_id);
  }

  @Post('join-channel')
  @UseGuards(ClerkAuthGuard)
  async joinChannel(@Req() req: any, @Body() body: { channel_id: string }) {
    const clerkId = (req.user as any)?.sub;
    if (!clerkId) {
      throw new UnauthorizedException('User not authenticated');
    }
    if (!body.channel_id) {
      throw new BadRequestException('channel_id is required');
    }
    try {
      return await this.slackService.joinChannel(clerkId, body.channel_id);
    } catch (err) {
      this.logger.error('Slack joinChannel error:', err.stack);
      throw new BadGatewayException(`Slack API error: ${err.message}`);
    }
  }

  // Project-level endpoints
  @Get('projects/:projectId/channels')
  @UseGuards(ClerkAuthGuard)
  async listChannelsForProject(@Param('projectId') projectId: string) {
    return this.slackService.getChannelsForProject(projectId);
  }

  @Post('projects/:projectId/update-channel')
  @UseGuards(ClerkAuthGuard)
  async updateSelectedChannelForProject(@Param('projectId') projectId: string, @Body() body: { channel_id: string }) {
    if (!body.channel_id) {
      throw new BadRequestException('channel_id is required');
    }
    return this.slackService.updateSelectedChannelForProject(projectId, body.channel_id);
  }

  @Post('projects/:projectId/join-channel')
  @UseGuards(ClerkAuthGuard)
  async joinChannelForProject(@Param('projectId') projectId: string, @Body() body: { channel_id: string }) {
    if (!body.channel_id) {
      throw new BadRequestException('channel_id is required');
    }
    return this.slackService.joinChannelForProject(projectId, body.channel_id);
  }

  @Get('projects/:projectId/status')
  @UseGuards(ClerkAuthGuard)
  async getProjectSlackStatus(@Param('projectId') projectId: string) {
    return this.slackService.checkProjectSlackConnection(projectId);
  }

  @Get('user-info/:userId')
  @UseGuards(ClerkAuthGuard)
  async getUserSlackInfo(@Req() req: any, @Param('userId') userId: string) {
    // Get clerk_id from authenticated user
    const clerkId = (req.user as any)?.sub;
    if (!clerkId) {
      throw new UnauthorizedException('User not authenticated');
    }
    return this.slackService.getUserSlackInfo(clerkId);
  }
}
