import { 
  Body, Controller, Get, Param, Post, Query, Res, 
  BadGatewayException, BadRequestException, InternalServerErrorException, UnauthorizedException, Logger 
} from '@nestjs/common';
import { JiraService } from '../services/jira.service';
import { Response } from 'express';
import { CheckJira, TempJiraInfo, JiraIssue, LinkJira } from '../dto/jira.dto';

@Controller('jira')
export class JiraController {
  private readonly logger = new Logger(JiraController.name);

  constructor(private readonly jiraService: JiraService) {}

  @Get('oAuth/:user_id')
  async jiraAuth(
    @Query('code') code: string, 
    @Param('user_id') user_id: string,
    @Res() res: Response
  ) {
    if (!code) {
      this.logger.warn(`Missing Jira authorization code for user: ${user_id}`);
      throw new BadRequestException('Missing Jira authorization code');
    }

    const link_jira: LinkJira = { user_id, code };

    try {
      await this.jiraService.linkProject(link_jira);
      return res.json({ id: user_id });
    } catch (err) {
      this.logger.error(`Failed to link Jira project for user: ${user_id}`, err.stack);
      throw new BadGatewayException('Failed to link Jira project');
    }
  }

  @Get('gen-code')
  async genCode() {
    try {
      return await this.jiraService.generateCode();
    } catch (err) {
      this.logger.error('Failed to generate Jira code', err.stack);
      throw new InternalServerErrorException('Failed to generate Jira code');
    }
  }

  @Post('insert-code')
  async codeJira(@Body() temp_jira_info: TempJiraInfo) {
    try {
      return await this.jiraService.addTempUrl(temp_jira_info);
    } catch (err) {
      this.logger.error('Failed to insert Jira code', err.stack);
      throw new BadGatewayException('Failed to insert Jira code');
    }
  }

  @Post('create-issue')
  async createJiraIssue(@Body() jira_issue: JiraIssue) {
    try {
      return await this.jiraService.createIssue(jira_issue);
    } catch (err) {
      this.logger.error('Failed to create Jira issue', err.stack);
      throw new BadGatewayException('Failed to create Jira issue');
    }
  }

  @Get('user-info/:user_id')
  async getJiraInfo(@Param('user_id') user_id: string) {
    try {
      return await this.jiraService.getUserInfo(user_id);
    } catch (err) {
      this.logger.error(`Failed to fetch Jira user info for user: ${user_id}`, err.stack);
      if (err.response?.status === 401) {
        throw new UnauthorizedException('Invalid Jira credentials');
      }
      throw new BadGatewayException('Failed to fetch Jira user info');
    }
  }

  @Post('check-link')
  async checkJiraLink(@Body() check_jira: CheckJira) {
    try {
      return await this.jiraService.linkExists(check_jira);
    } catch (err) {
      this.logger.error('Failed to check Jira link', err.stack);
      throw new BadGatewayException('Failed to check Jira link');
    }
  }

  @Get('check-link/:user_watchlist_id')
  async checkJiraCon(@Param('user_watchlist_id') user_watchlist_id: string) {
    try {
      return await this.jiraService.checkJiraUserWatch(user_watchlist_id);
    } catch (err) {
      this.logger.error('Failed to check Jira connection', err.stack);
      throw new BadGatewayException('Failed to check Jira connection');
    }
  }
}
