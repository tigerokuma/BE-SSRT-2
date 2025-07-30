import { Injectable, Body } from '@nestjs/common';
import { JiraRepository } from '../repositories/jira.repository';
import { JiraIssue } from '../dto/jira.dto';
import { randomBytes } from 'crypto';
import axios from 'axios';


@Injectable()
export class JiraService {

  constructor(private jiraRepository: JiraRepository) {}

  async addTempUrl(@Body() jiraInfo: any) {
    const record = await this.checkTempJiraInfo(jiraInfo.code);

    // check if code is already in table
    if (record) {
      throw new Error("Code already in db");
    }
    
    const expires_at = new Date(Date.now() + 15 * 60 * 1000);
    const dataWithExpiry = {
      ...jiraInfo,
      expires_at,
    };

    this.jiraRepository.insertTempInfo(dataWithExpiry);
  }

  async checkTempJiraInfo(code: string) {
    return await this.jiraRepository.checkCode(code);
  }

  async linkProject(@Body() insertJira: any) {
    const jiraInfo = await this.jiraRepository.getJiraInfo(insertJira.uwlId);
    
    if(!jiraInfo){
      throw new Error("Code expired.");
    }

    this.jiraRepository.insertJiraInfo({
        userId: insertJira.user_id,
        webtriggerUrl: jiraInfo.webtrigger_url,
        projectKey: jiraInfo.project_key!,
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

  async generateCode(length = 32): Promise<string> {
    let unique = false;
    let code = '';

    while (!unique) {
      code = randomBytes(length).toString('hex').slice(0, length);
      const existing = await this.checkTempJiraInfo(code);

      if (!existing) {
        unique = true; 
      }
    }

    return code;
  }

  async linkExists(checkJira: {projectKey: string, webtrigger_url: string}) {
    return this.jiraRepository.checkJiraLink(checkJira);
  }

}
