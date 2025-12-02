import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { JiraInsert } from '../dto/jira.dto';

@Injectable()
export class JiraRepository {
  constructor(private readonly prisma: PrismaService) {}


  async insertJiraInfo(jiraInsert: JiraInsert) {
    return this.prisma.jira.upsert({
      where: { id: jiraInsert.user_id },
      update: {
        webtrigger_url: jiraInsert.webtrigger_url,
        project_key: jiraInsert.project_key,
      },
      create: {
        id: jiraInsert.user_id,
        webtrigger_url: jiraInsert.webtrigger_url,
        project_key: jiraInsert.project_key,
      },
    });
  }

  async getJiraInfoUser(userId: string) {
    return await this.prisma.jira.findUnique({
      where: { id: userId },
      select: { webtrigger_url: true, project_key: true },
    });
  }

  async deleteJiraInfo(userId: string) {
    return await this.prisma.jira.delete({
      where: { id: userId },
    });
  }
  // Project-level Jira methods
  async insertProjectJiraInfo(projectId: string, data: {
    webtrigger_url: string;
    project_key?: string;
    cloud_id?: string;
  }) {
    return this.prisma.projectJira.upsert({
      where: { project_id: projectId },
      update: {
        webtrigger_url: data.webtrigger_url,
        project_key: data.project_key,
        cloud_id: data.cloud_id,
      },
      create: {
        project_id: projectId,
        webtrigger_url: data.webtrigger_url,
        project_key: data.project_key,
        cloud_id: data.cloud_id,
      },
    });
  }

  async getProjectJiraInfo(projectId: string) {
    return await this.prisma.projectJira.findUnique({
      where: { project_id: projectId },
      select: { webtrigger_url: true, project_key: true, cloud_id: true },
    });
  }

  async deleteProjectJiraInfo(projectId: string) {
    return await this.prisma.projectJira.delete({
      where: { project_id: projectId },
    });
  }

  // User token operations
  async updateUserJiraTokens(userId: string, accessToken: string, refreshToken: string) {
    return await this.prisma.user.update({
      where: { user_id: userId },
      data: {
        jira_access_token: accessToken,
        jira_refresh_token: refreshToken,
      },
    });
  }

  async getUserJiraAccessToken(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { user_id: userId },
      select: { jira_access_token: true },
    });
    return user?.jira_access_token || null;
  }

  // Project token operations
  async updateProjectJiraTokens(projectId: string, accessToken: string, refreshToken: string) {
    return await this.prisma.project.update({
      where: { id: projectId },
      data: {
        jira_access_token: accessToken,
        jira_refresh_token: refreshToken,
      },
    });
  }

  async getProjectJiraAccessToken(projectId: string): Promise<string | null> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { jira_access_token: true },
    });
    return project?.jira_access_token || null;
  }
}
