import { Controller, Get, Post } from '@nestjs/common';
import { SlackService } from '../services/slack.service';


@Controller('slack')
export class SlackController {
  constructor(private readonly slackService: SlackService) {}

  @Get('oauth')
  handleOAuthCallback(body: any) {
    this.slackService.exchangeCodeForToken(body);
  }

  @Post('channel')
  getSlackChannel(body: any) {
    return this.slackService.getSlackChannel(body);
  }

}
