import { Controller, Get, Post, Res, Body, Redirect, Query, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { SlackService } from '../services/slack.service';
import { SlackOauthConnect } from '../dto/slack.dto';
import { ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';



@Controller('slack')
export class SlackController {
  constructor(private readonly slackService: SlackService) {}

  @Get('channels')
  async listChannels() {
    return this.slackService.getChannels({});
  }

  @Post('join-channel')
  async joinChannel() {
    return await this.slackService.joinChannel('C091R4KE2QN');
  }

  @Post('test-message')
  async testMessage() {
    return this.slackService.sendMessage("hello world");
  }

  @Get('start-oauth')
  @ApiOperation({ 
    summary: 'Get Slack OAuth URL for current user' ,
    description: 'Click <a href="/slack/start-oauth" target="_blank" rel="noopener noreferrer">Authorize Slack App</a> to open in a new tab.'
  })
  startSlackOAuth(@Res() res: Response) {
    const userId = '1';
    const clientId = process.env.SLACK_CLIENT_ID;
    const redirectUrl = process.env.SLACK_REDIRECT_URL;
    if (!clientId || !redirectUrl) {
      throw new Error('SLACK_CLIENT_ID is not set in .env');
    }

    const slackUrl = new URL('https://slack.com/oauth/v2/authorize');
    slackUrl.searchParams.set('client_id', clientId);
    slackUrl.searchParams.set('scope', 'chat:write,channels:read,channels:join,channels:manage');
    slackUrl.searchParams.set('redirect_uri', redirectUrl);
    slackUrl.searchParams.set('state', userId);

    return res.redirect(slackUrl.toString()) ;
  }

  @Get('oauth')
  @Redirect('/api', 302)
  handleOAuthCallback(@Query() slackOauthConnect: SlackOauthConnect) {
    if (!slackOauthConnect.code) {
      throw new BadRequestException('Missing code from Slack');
    }
    try {
      this.slackService.exchangeCodeForToken(slackOauthConnect.code);
    } catch (err) {
      throw new InternalServerErrorException('OAuth exchange failed');
    }
    
  }
}
