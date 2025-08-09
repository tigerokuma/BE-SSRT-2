import { 
  Controller, Get, Post, Res, Body, Query, Param, Logger,
  BadGatewayException, BadRequestException, InternalServerErrorException, UnauthorizedException 
} from '@nestjs/common'; 
import { SlackService } from '../services/slack.service';
import { SlackOauthConnect, UserChannel, UserMessage } from '../dto/slack.dto';
import { Response } from 'express';

@Controller('slack')
export class SlackController {
  private readonly logger = new Logger(SlackController.name);
  private readonly id: string; // change this when a user login system has been implemented

  constructor(private readonly slackService: SlackService) {}

  @Get('slack-channel/:user_id')
  async checkConnection(@Param('user_id') user_id: string) {
    if (!user_id) {
      this.logger.warn('checkConnection called without user_id');
      throw new BadRequestException('Missing user_id parameter');
    }
    try {
      return await this.slackService.getSlackChannel(user_id);
    } catch (err) {
      this.logger.error(`Failed to get Slack channel for user: ${user_id}`, err.stack);
      throw new BadGatewayException('Failed to fetch Slack channel');
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

  @Get('channels/:user_id')
  async listChannels(@Param('user_id') user_id: string) {
    if (!user_id) {
      this.logger.warn('listChannels called without user_id');
      throw new BadRequestException('Missing user_id parameter');
    }
    try {
      return await this.slackService.getChannels(user_id);
    } catch (err) {
      this.logger.error('Slack listChannels error:', err.stack);

      if (err.response?.data?.error === 'invalid_auth') {
        throw new UnauthorizedException('Invalid Slack credentials');
      }

      throw new BadGatewayException('Failed to fetch Slack channels');
    }
  }

  @Post('join-channel')
  async joinChannel(@Body() userChannel: UserChannel) {
    if (!userChannel) {
      this.logger.warn('joinChannel called without userChannel body');
      throw new BadRequestException('Missing userChannel body');
    }
    try {
      return await this.slackService.joinChannel(userChannel);
    } catch (err) {
      this.logger.error('Slack joinChannel error:', err.stack);
      throw new BadGatewayException(`Slack API error: ${err.message}`);
    }
  }

  @Get('start-oauth/:user_id')
  startSlackOAuth(@Res() res: Response, @Param('user_id') user_id: string) {
    if (!user_id) {
      this.logger.warn('startSlackOAuth called without user_id');
      throw new BadRequestException('Missing user_id parameter');
    }
    try {
      const slackUrl = this.slackService.getOAuthUrl(user_id);
      return res.redirect(slackUrl);
    } catch (err) {
      this.logger.error('startSlackOAuth error:', err.stack);
      throw new InternalServerErrorException('Could not generate Slack OAuth URL');
    }
  }

  @Get('oauth')
  async handleOAuthCallback(@Query() slackOauthConnect: SlackOauthConnect) {
    if (!slackOauthConnect?.code) {
      this.logger.warn('handleOAuthCallback called without code');
      throw new BadRequestException('Missing code from Slack');
    }
    try {
      await this.slackService.exchangeCodeForToken(slackOauthConnect);
      return { success: true };
    } catch (err) {
      this.logger.error('OAuth exchange failed:', err.stack);

      if (err.response?.data?.error === 'invalid_code') {
        throw new BadRequestException('Invalid Slack OAuth code');
      }

      throw new BadGatewayException('Slack OAuth token exchange failed');
    }
  }
}
