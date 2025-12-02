import { Injectable, BadRequestException, BadGatewayException, Logger } from '@nestjs/common';
import { SlackRepository } from '../repositories/slack.repository';
import { randomUUID } from 'crypto';
import { UserService } from '../../user/user.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import axios from 'axios';
import { UserMessage } from '../dto/slack.dto';

@Injectable()
export class SlackService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUrl: string;
  private readonly frontendUrl: string;
  private readonly logger = new Logger(SlackService.name);

  constructor(
    private slackRepository: SlackRepository,
    private userService: UserService,
    private prisma: PrismaService,
  ) {
    this.clientId = process.env.SLACK_CLIENT_ID!;
    this.clientSecret = process.env.SLACK_CLIENT_SECRET!;
    this.redirectUrl = process.env.SLACK_REDIRECT_URL!;
    this.frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  }

  redirectToSlack(res: any, clerkId: string, type: 'user' | 'project' = 'user', projectId?: string) {
    const state = randomUUID();
    
    // Store state with clerk_id and type (user or project)
    // For project connections, also include projectId
    const stateData: any = { state, clerkId, type };
    if (type === 'project' && projectId && projectId.trim() !== '') {
      stateData.projectId = projectId.trim();
    }
    const stateWithUser = Buffer.from(JSON.stringify(stateData)).toString('base64');

    // Use ngrok URL for Slack OAuth callback (required by Slack)
    const slackBaseUrl = process.env.SLACK_BASE_URL || 'https://open-source-insight-tracker.vercel.app';
    const redirectUri = `${slackBaseUrl}/slack/oauth/callback`;

    const url =
      'https://slack.com/oauth/v2/authorize?' +
      new URLSearchParams({
        client_id: this.clientId,
        scope: 'chat:write, channels:read, channels:join, channels:manage, groups:read, groups:write',
        redirect_uri: redirectUri,
        state: stateWithUser,
      });

    return res.redirect(url);
  }

  // --------------------------------------------------------
  // 2. HANDLE OAUTH CALLBACK
  // --------------------------------------------------------
  async handleOAuthCallback(req: any, query: any, res: any) {
    const code = query.code;
    const state = query.state;

    if (!code) {
      throw new BadRequestException('Missing authorization code');
    }

    if (!state) {
      throw new BadRequestException('Missing state parameter');
    }

    // Decode state to get clerk_id, type, and optionally projectId
    let userClerkId: string | null = null;
    let connectionType: 'user' | 'project' = 'user';
    let projectId: string | null = null;
    try {
      const decoded = JSON.parse(Buffer.from(state, 'base64').toString());
      userClerkId = decoded.clerkId || null;
      connectionType = decoded.type || 'user';
      projectId = decoded.projectId || null;
      
      // Validate projectId if it exists
      if (projectId && (typeof projectId !== 'string' || projectId.trim() === '')) {
        projectId = null;
      } else if (projectId) {
        projectId = projectId.trim();
      }
    } catch (e) {
      throw new BadRequestException('Invalid state parameter');
    }

    if (!userClerkId) {
      throw new BadRequestException('Could not extract user ID from state');
    }

    if (connectionType === 'project' && (!projectId || projectId.trim() === '')) {
      throw new BadRequestException('Project ID is required for project-level connections');
    }

    // Use ngrok URL for Slack OAuth callback (required by Slack)
    const slackBaseUrl = process.env.SLACK_BASE_URL || 'https://open-source-insight-tracker.vercel.app';
    const redirectUri = `${slackBaseUrl}/slack/oauth/callback`;

    // Exchange code for tokens
    const tokenRes = await axios.post(
      'https://slack.com/api/oauth.v2.access',
      new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: redirectUri,
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      },
    );

    if (!tokenRes.data.ok) {
      throw new BadGatewayException(`Failed to exchange code for token: ${tokenRes.data.error}`);
    }

    const accessToken = tokenRes.data.access_token;
    const refreshToken = tokenRes.data.refresh_token;

    if (!accessToken) {
      throw new BadGatewayException('No access token received from Slack');
    }

    // Store tokens + connection info in DB based on connection type
    // Use ngrok URL for redirects (same as OAuth callback URL)
    const frontendUrl = process.env.FRONTEND_URL || 'https://open-source-insight-tracker.vercel.app';
    
    if (connectionType === 'project' && projectId) {
      await this.saveProjectSlackConnection(projectId, {
        access_token: accessToken,
        refresh_token: refreshToken || null,
      });
      // For project connections, redirect to channel selection page to choose Slack channel
      // Ensure projectId is valid before redirecting
      if (!projectId || projectId.trim() === '') {
        // Fallback to settings page if projectId is invalid
        return res.redirect(`${frontendUrl}/settings?slack_connected=true`);
      }
      // Redirect to Slack channel selection page with project_id parameter
      try {
        const redirectUrl = new URL('/slack/select-channel', frontendUrl);
        redirectUrl.searchParams.set('project_id', projectId);
        return res.redirect(redirectUrl.toString());
      } catch (error) {
        // Fallback to manual URL construction if URL parsing fails
        const separator = frontendUrl.includes('?') ? '&' : '?';
        return res.redirect(`${frontendUrl}/slack/select-channel${separator}project_id=${encodeURIComponent(projectId)}`);
      }
    } else {
      // User-level connection
      await this.saveUserSlackConnection(userClerkId!, {
        access_token: accessToken,
        refresh_token: refreshToken || null,
      });
      // Redirect to channel selection page
      try {
        const redirectUrl = new URL('/slack/select-channel', frontendUrl);
        return res.redirect(redirectUrl.toString());
      } catch (error) {
        // Fallback to manual URL construction if URL parsing fails
        return res.redirect(`${frontendUrl}/slack/select-channel`);
      }
    }
  }

  // --------------------------------------------------------
  // 3. GET CHANNELS
  // --------------------------------------------------------
  async getChannels(clerkUserId: string) {
    // Get access token from database (stored during OAuth callback)
    const accessToken = await this.getSlackAccessTokenFromDatabase(clerkUserId);
    if (!accessToken) {
      throw new Error('Slack access token not found. Please reconnect your Slack account.');
    }

    const response = await axios.get(
      'https://slack.com/api/conversations.list',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: {
          exclude_archived: true,
          limit: 100,
          types: 'public_channel,private_channel',
        },
      },
    );

    if (!response.data.ok) {
      throw new Error(`Slack API error: ${response.data.error}`);
    }

    return { channels: response.data.channels };
  }

  // --------------------------------------------------------
  // 4. UPDATE SELECTED CHANNEL
  // --------------------------------------------------------
  async updateSelectedChannel(clerkUserId: string, channelId: string) {
    // Get backend user_id from clerk_id
    const user = await this.userService.getUserByClerkId(clerkUserId);
    if (!user) {
      throw new Error(`User not found for clerk_id: ${clerkUserId}`);
    }

    // Get existing Slack connection
    const slackInfo = await this.slackRepository.getSlackInfoUser(user.user_id);
    if (!slackInfo) {
      throw new Error('Slack connection not found. Please connect your Slack account first.');
    }

    // Update channel
    await this.slackRepository.insertSlackInfo({
      user_id: user.user_id,
      token: slackInfo.slack_token,
      channel: channelId,
    });

    return { success: true, channel_id: channelId };
  }

  // --------------------------------------------------------
  // 5. JOIN CHANNEL
  // --------------------------------------------------------
  async joinChannel(clerkUserId: string, channelId: string) {
    // Get backend user_id from clerk_id
    const user = await this.userService.getUserByClerkId(clerkUserId);
    if (!user) {
      throw new Error(`User not found for clerk_id: ${clerkUserId}`);
    }

    // Get access token from database
    const accessToken = await this.getSlackAccessTokenFromDatabase(clerkUserId);
    if (!accessToken) {
      throw new Error('Slack access token not found. Please reconnect your Slack account.');
    }

    // Join the channel
    const response = await axios.post(
      'https://slack.com/api/conversations.join',
      { channel: channelId },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      },
    );

    if (!response.data.ok) {
      throw new Error(`Slack API error: ${response.data.error}`);
    }

    // Update channel in database
    const slackInfo = await this.slackRepository.getSlackInfoUser(user.user_id);
    await this.slackRepository.insertSlackInfo({
      user_id: user.user_id,
      token: slackInfo?.slack_token || accessToken,
      channel: channelId,
    });

    return { channel: response.data.channel };
  }

  // --------------------------------------------------------
  // DATABASE HELPERS
  // --------------------------------------------------------
  async saveUserSlackConnection(clerkUserId: string, data: {
    access_token: string;
    refresh_token: string | null;
  }) {
    // Get backend user_id from clerk_id
    const user = await this.userService.getUserByClerkId(clerkUserId);
    if (!user) {
      throw new Error(`User not found for clerk_id: ${clerkUserId}`);
    }

    // Save connection info without channel - user will select it later
    await this.slackRepository.insertSlackInfo({
      user_id: user.user_id,
      token: data.access_token,
      channel: null,
    });

    // Store tokens in User table using dedicated Slack token fields
    try {
      await this.slackRepository.updateUserSlackTokens(
        user.user_id,
        data.access_token,
        data.refresh_token,
      );
    } catch (err) {
      this.logger.warn('Failed to store Slack tokens in User table:', err);
      // Continue even if token storage fails - connection info is still saved
    }

    return {
      user_id: user.user_id,
    };
  }

  async getUserSlackConnection(clerkUserId: string) {
    // Get backend user_id from clerk_id
    const user = await this.userService.getUserByClerkId(clerkUserId);
    if (!user) {
      throw new Error(`User not found for clerk_id: ${clerkUserId}`);
    }

    // Get Slack info from database
    const slackInfo = await this.slackRepository.getSlackInfoUser(user.user_id);
    if (!slackInfo) {
      throw new Error(`Slack connection not found for user: ${clerkUserId}`);
    }

    return {
      slack_token: slackInfo.slack_token,
      slack_channel: slackInfo.slack_channel,
    };
  }

  /**
   * Get user Slack info for the settings page
   * Returns slack_token and slack_channel (or null if not connected)
   */
  async getUserSlackInfo(clerkUserId: string) {
    try {
      // Get backend user_id from clerk_id
      const user = await this.userService.getUserByClerkId(clerkUserId);
      if (!user) {
        return { slack_token: null, slack_channel: null };
      }

      // Get Slack info from database
      const slackInfo = await this.slackRepository.getSlackInfoUser(user.user_id);
      if (!slackInfo) {
        return { slack_token: null, slack_channel: null };
      }

      return {
        slack_token: slackInfo.slack_token || null,
        slack_channel: slackInfo.slack_channel || null,
      };
    } catch (error) {
      return { slack_token: null, slack_channel: null };
    }
  }

  /**
   * Get Slack OAuth access token from database (stored during OAuth callback)
   */
  private async getSlackAccessTokenFromDatabase(clerkUserId: string): Promise<string | null> {
    try {
      // Get backend user_id from clerk_id
      const user = await this.userService.getUserByClerkId(clerkUserId);
      if (!user) {
        return null;
      }

      // Get token from User table using dedicated Slack token field
      return await this.slackRepository.getUserSlackAccessToken(user.user_id);
    } catch (err) {
      this.logger.error('Failed to get Slack access token from database:', err);
      return null;
    }
  }

  /**
   * Get Slack OAuth access token for a project from database
   */
  private async getProjectSlackAccessTokenFromDatabase(projectId: string): Promise<string | null> {
    try {
      return await this.slackRepository.getProjectSlackAccessToken(projectId);
    } catch (err) {
      this.logger.error('Failed to get project Slack access token from database:', err);
      return null;
    }
  }

  // --------------------------------------------------------
  // PROJECT-LEVEL SLACK CONNECTION METHODS
  // --------------------------------------------------------
  async saveProjectSlackConnection(projectId: string, data: {
    access_token: string;
    refresh_token: string | null;
  }) {
    // Save connection info to ProjectSlack table
    await this.slackRepository.insertProjectSlackInfo(projectId, {
      slack_token: data.access_token,
      slack_channel: null,
    });

    // Store tokens in Project table using dedicated Slack token fields
    try {
      await this.slackRepository.updateProjectSlackTokens(
        projectId,
        data.access_token,
        data.refresh_token,
      );
    } catch (err) {
      this.logger.warn('Failed to store Slack tokens in Project table:', err);
      // Continue even if token storage fails - connection info is still saved
    }

    return {
      project_id: projectId,
    };
  }

  async getProjectSlackConnection(projectId: string) {
    // Get Slack info from ProjectSlack table
    const slackInfo = await this.slackRepository.getProjectSlackInfo(projectId);
    if (!slackInfo) {
      throw new Error(`Slack connection not found for project: ${projectId}`);
    }

    return {
      slack_token: slackInfo.slack_token,
      slack_channel: slackInfo.slack_channel,
    };
  }

  async checkProjectSlackConnection(projectId: string) {
    try {
      const slackInfo = await this.slackRepository.getProjectSlackInfo(projectId);
      const hasTokens = await this.slackRepository.getProjectSlackAccessToken(projectId);
      
      // Slack is considered connected only if:
      // 1. slackInfo exists (has slack_token)
      // 2. hasTokens exists (OAuth tokens are stored)
      // 3. slack_channel is set (Slack channel has been selected)
      const hasSlackToken = !!slackInfo?.slack_token;
      const hasChannel = !!slackInfo?.slack_channel && slackInfo.slack_channel.trim() !== '';
      
      return {
        connected: !!slackInfo && !!hasTokens && hasSlackToken && hasChannel,
        channel_id: slackInfo?.slack_channel || null,
      };
    } catch (error) {
      return {
        connected: false,
        channel_id: null,
      };
    }
  }

  async getChannelsForProject(projectId: string) {
    // Get access token from database (stored during OAuth callback)
    const accessToken = await this.getProjectSlackAccessTokenFromDatabase(projectId);
    if (!accessToken) {
      throw new Error('Slack access token not found. Please reconnect your Slack account.');
    }

    const response = await axios.get(
      'https://slack.com/api/conversations.list',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: {
          exclude_archived: true,
          limit: 100,
          types: 'public_channel,private_channel',
        },
      },
    );

    if (!response.data.ok) {
      throw new Error(`Slack API error: ${response.data.error}`);
    }

    return { channels: response.data.channels };
  }

  async updateSelectedChannelForProject(projectId: string, channelId: string) {
    // Get existing Slack connection
    const slackInfo = await this.slackRepository.getProjectSlackInfo(projectId);
    if (!slackInfo) {
      throw new Error('Slack connection not found. Please connect your Slack account first.');
    }

    // Update channel
    await this.slackRepository.insertProjectSlackInfo(projectId, {
      slack_token: slackInfo.slack_token,
      slack_channel: channelId,
    });

    return { success: true, channel_id: channelId };
  }

  async joinChannelForProject(projectId: string, channelId: string) {
    // Get access token from database
    const accessToken = await this.getProjectSlackAccessTokenFromDatabase(projectId);
    if (!accessToken) {
      throw new Error('Slack access token not found. Please reconnect your Slack account.');
    }

    // Join the channel
    const response = await axios.post(
      'https://slack.com/api/conversations.join',
      { channel: channelId },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      },
    );

    if (!response.data.ok) {
      throw new Error(`Slack API error: ${response.data.error}`);
    }

    // Update channel in database
    const slackInfo = await this.slackRepository.getProjectSlackInfo(projectId);
    await this.slackRepository.insertProjectSlackInfo(projectId, {
      slack_token: slackInfo?.slack_token || accessToken,
      slack_channel: channelId,
    });

    return { channel: response.data.channel };
  }

  // --------------------------------------------------------
  // SEND MESSAGE (for backward compatibility)
  // --------------------------------------------------------
  async sendMessage(userMessage: UserMessage) {
    try {
      const slackInfo = await this.slackRepository.getSlackInfoUserWatch(
        userMessage.user_watchlist_id,
      );
      const package_name = await this.slackRepository.getPackageName(
        userMessage.user_watchlist_id,
      );

      const response = await axios.post(
        'https://slack.com/api/chat.postMessage',
        {
          channel: slackInfo?.slack_channel,
          blocks: [
            {
              type: 'header',
              text: {
                type: 'plain_text',
                text: `New alert in ${package_name}`,
              },
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: userMessage.description,
              },
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `<${this.frontendUrl}/package-details?id=${userMessage.user_watchlist_id}>`,
              },
            },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${slackInfo?.slack_token}`,
            'Content-Type': 'application/json',
          },
        },
      );

      if (!response.data.ok) {
        throw new Error(`Slack API error: ${response.data.error}`);
      }
    } catch (err) {
      this.logger.error('Slack message failed to send.', err);
    }
  }
}
