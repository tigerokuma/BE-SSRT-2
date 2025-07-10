// src/jira/jira.controller.ts
import { Controller, Post } from '@nestjs/common';
import { JiraService } from  '../services/jira.service';

@Controller('jira')
export class JiraController {
  constructor(private readonly jiraService: JiraService) {}

  @Post('connect')
  connectJiraProject(body: any) {
    return this.jiraService.connectProject(body);
  }

  @Post('issue')
  createJiraIssue(body: any) {
    return this.jiraService.createIssue(body);
  }


}
