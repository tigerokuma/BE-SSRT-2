import { Injectable } from '@nestjs/common';
import { JiraRepository } from '../repositories/jira.repository';
import { CheckJira, JiraIssue, LinkJira, TempJiraInfo } from '../dto/jira.dto';
import { randomBytes } from 'crypto';
import axios from 'axios';

@Injectable()
export class JiraService {
  constructor(private jiraRepository: JiraRepository) {}

  async addTempUrl(jira_info: TempJiraInfo) {
    const record = await this.checkTempJiraInfo(jira_info.code);

    // check if code is already in table
    if (record) {
      throw new Error('Code already in db');
    }

    // set expiration 15 minutes from now
    const expires_at = new Date(Date.now() + 15 * 60 * 1000);
    const jira_info_expire = {
      ...jira_info,
      expires_at,
    };

    this.jiraRepository.insertTempInfo(jira_info_expire);
  }

  // Check if the code is already in the database
  async checkTempJiraInfo(code: string) {
    const temp = await this.jiraRepository.checkCode(code);
    return temp;
  }

  async linkProject(link_jira: LinkJira) {
    const jira_info = await this.jiraRepository.getTempJiraInfo(link_jira.code);

    // Check if code is still in db
    if (jira_info == null) {
      throw new Error('Code expired.');
    }

    this.jiraRepository.insertJiraInfo({
      user_id: link_jira.user_id,
      webtrigger_url: jira_info.webtrigger_url,
      project_key: jira_info.project_key,
    });
  }

  async createIssue(issue: JiraIssue) {
    const jiraInfo = await this.jiraRepository.getJiraInfoUserWatch(
      issue.user_watchlist_id,
    );

    if (!jiraInfo?.webtrigger_url) throw new Error('Missing webtrigger_url');

    const response = await axios.post(jiraInfo?.webtrigger_url, {
      project_key: jiraInfo?.project_key,
      summary: issue.summary,
      description: issue.description,
    });

    return response.data;
  }

  async generateCode(length = 32): Promise<string> {
    let unique = false;
    let code = '';

    // Generate random code until it is not in db
    while (!unique) {
      code = randomBytes(length).toString('hex').slice(0, length);
      const existing = await this.checkTempJiraInfo(code);

      if (!existing) {
        unique = true;
      }
    }

    return code;
  }

  async getUserInfo(user_id: string) {
    const userInfo = await this.jiraRepository.getJiraInfoUser(user_id);
    return { project_key: userInfo?.project_key };
  }

  async linkExists(checkJira: CheckJira) {
    const temp = await this.jiraRepository.checkJiraLink(checkJira);
    return temp?.user.user_id;
  }

  async checkJiraUserWatch(user_watchlist_id: string) {
    const jiraInfo =
      await this.jiraRepository.getJiraInfoUserWatch(user_watchlist_id);
    if (jiraInfo) {
      return {
        success: true,
        data: jiraInfo,
      };
    }

    return {
      success: false,
      message: 'No Jira info found for this watchlist',
    };
  }
}
