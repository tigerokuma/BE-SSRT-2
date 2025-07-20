import { Controller, Get, Post, Res, Body, Redirect, Query } from '@nestjs/common'; 
import { BadGatewayException, BadRequestException, InternalServerErrorException, UnauthorizedException } from '@nestjs/common'; 
import { SlackService } from '../services/slack.service';
import { SlackOauthConnect } from '../dto/slack.dto';
import { ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';

@Controller('slack')
export class SlackController {
  private readonly id: string; // change this when a user login system has been implemented
  constructor(private readonly slackService: SlackService) {
    this.id = 'user_watchlist_henry_watchlist_clerk_javascript_1752958451379';
  }

  @Get('channels')
  async listChannels() {
    try {
      return await this.slackService.getChannels(this.id);
    } catch (err) {
      console.error('Slack listChannels error:', err);

      if (err.response?.data?.error === 'invalid_auth') {
        throw new UnauthorizedException('Invalid Slack credentials');
      }

      throw new BadGatewayException('Failed to fetch Slack channels');
    }
  }

  @Post('join-channel')
  async joinChannel(
    @Body('channel') channel: string) {
    try {
      return await this.slackService.joinChannel(this.id, channel);
    } catch (err) {
      throw new BadGatewayException(`Slack API error: ${err.message}`);
    }
  }

  @Get('start-oauth')
  @ApiOperation({ 
    summary: 'Get Slack OAuth URL for current user' ,
    description: 'Click <a href="/slack/start-oauth" target="_blank" rel="noopener noreferrer">Authorize Slack App</a> to open in a new tab.'
  }) //temporarily has this to interact with the swagger api
  startSlackOAuth(
    @Res() res: Response
    ) {
    try{
      const slackUrl = this.slackService.getOAuthUrl(this.id);
      return res.redirect(slackUrl) ;
    } catch (err) {
      console.error('startSlackOAuth error:', err);
      throw new InternalServerErrorException('Could not generate Slack OAuth URL');
    }
  }

  @Get('oauth')
  @Redirect('/api', 302)
  async handleOAuthCallback(@Query() slackOauthConnect: SlackOauthConnect) {
    if (!slackOauthConnect.code) {
      throw new BadRequestException('Missing code from Slack');
    }

    try {
      await this.slackService.exchangeCodeForToken(this.id, slackOauthConnect.code, slackOauthConnect.state);
    } catch (err) {
      console.error('OAuth exchange failed:', err);

      if (err.response?.data?.error === 'invalid_code') {
        throw new BadRequestException('Invalid Slack OAuth code');
      }

      throw new BadGatewayException('Slack OAuth token exchange failed');
    }
    
  }
}
