import { Controller, Get, Post, Res, Body, Query, Param } from '@nestjs/common'; 
import { BadGatewayException, BadRequestException, InternalServerErrorException, UnauthorizedException } from '@nestjs/common'; 
import { SlackService } from '../services/slack.service';
import { SlackOauthConnect } from '../dto/slack.dto';
import { Response } from 'express';

@Controller('slack')
export class SlackController {
  private readonly id: string; // change this when a user login system has been implemented
  constructor(private readonly slackService: SlackService) {}

  @Get('slack-channel/:user_id')
  async checkConnection(@Param('user_id') user_id: string) {
    return await this.slackService.getSlackChannel(user_id);
  }

  @Get('send-message/:user_id')
  async sendMessage(@Param('user_id') user_id: string, message: string) {
    return await this.slackService.sendMessage(user_id, message);
  }

  @Get('channels/:user_id')
  async listChannels(@Param('user_id') user_id: string) {
    try {
      const temp= await this.slackService.getChannels(user_id);
      console.log(temp);
      return temp;
    } catch (err) {
      console.error('Slack listChannels error:', err);

      if (err.response?.data?.error === 'invalid_auth') {
        throw new UnauthorizedException('Invalid Slack credentials');
      }

      throw new BadGatewayException('Failed to fetch Slack channels');
    }
  }

  @Post('join-channel')
  async joinChannel(@Body() body: { user_id: string; channel: string }) {
    try {
      return await this.slackService.joinChannel(body.user_id, body.channel);
    } catch (err) {
      throw new BadGatewayException(`Slack API error: ${err.message}`);
    }
  }

  @Get('start-oauth/:user_id')
  startSlackOAuth(@Res() res: Response, @Param('user_id') user_id: string) {
    console.log(user_id);
    try{
      const slackUrl = this.slackService.getOAuthUrl(user_id);
      return res.redirect(slackUrl) ;
    } catch (err) {
      console.error('startSlackOAuth error:', err);
      throw new InternalServerErrorException('Could not generate Slack OAuth URL');
    }
  }

  @Get('oauth')
  async handleOAuthCallback(@Query() slackOauthConnect: SlackOauthConnect) {
    if (!slackOauthConnect.code) {
      throw new BadRequestException('Missing code from Slack');
    }
    try {
      await this.slackService.exchangeCodeForToken(slackOauthConnect.code, slackOauthConnect.state);
    } catch (err) {
      console.error('OAuth exchange failed:', err);

      if (err.response?.data?.error === 'invalid_code') {
        throw new BadRequestException('Invalid Slack OAuth code');
      }

      throw new BadGatewayException('Slack OAuth token exchange failed');
    }
    
  }
}
