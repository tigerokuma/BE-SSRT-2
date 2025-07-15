import { Controller, Get, Post, Query,  } from '@nestjs/common';
import { JiraService } from  '../services/jira.service';

@Controller('jira')
export class JiraController {
  constructor(private readonly jiraService: JiraService) {}

  @Get('connect')
  connectJira(
  @Query('projectKey') projectKey: string,
  @Query('webtriggerUrl') webtriggerUrl: string,) 
  {
    const body = { projectKey, webtriggerUrl };
    return this.jiraService.connectProject(body);
  }

  @Post('issue')
  createJiraIssue(body: any) 
  {
    return this.jiraService.createIssue(body);
  }

}
