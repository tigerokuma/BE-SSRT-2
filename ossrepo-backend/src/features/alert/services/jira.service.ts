import { Injectable, Body } from '@nestjs/common';
import { JiraRepository } from '../repositories/jira.repository';
import { JiraIssue } from '../dto/jira.dto';
import axios from 'axios';


@Injectable()
export class JiraService {

  constructor(private jiraRepository: JiraRepository) {}

  async connectProject(@Body() dto: any) {
    this.jiraRepository.insertJiraInfo({
        userId: '1',
        webtriggerUrl: dto.webtriggerUrl,
        projectKey: dto.projectKey,
    })
  }

  async createIssue(issue: JiraIssue) {
    const jiraInfo = await this.jiraRepository.getJiraInfo(issue.userID);
    if(!jiraInfo?.webtrigger_url)
      throw new Error('Missing webtrigger_url'); 
    const response = await axios.post(jiraInfo?.webtrigger_url, {
      projectKey: jiraInfo?.project_key,
      summary: issue.summary,
      description: issue.description,
    });
    return response.data;
  }

}
