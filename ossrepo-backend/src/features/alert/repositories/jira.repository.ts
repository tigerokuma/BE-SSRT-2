import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { JiraInsert } from '../dto/jira.dto';

@Injectable()
export class JiraRepository {
  constructor(private readonly prisma: PrismaService) {}

  async insertJiraInfo(jiraInsert: JiraInsert) {
    return this.prisma.jira.upsert({
        where: {id: jiraInsert.userId},
        update: {
            webtrigger_url: jiraInsert.webtriggerUrl,
            project_key: jiraInsert.projectKey
        },
        create: {
            id: jiraInsert.userId,
            webtrigger_url: jiraInsert.webtriggerUrl,
            project_key: jiraInsert.projectKey
        }
    });
  }

  async getJiraInfo(userId: string) {
    return await this.prisma.jira.findUnique({
      where: { id: userId },
      select: { webtrigger_url: true, project_key: true },
    });

  }
}