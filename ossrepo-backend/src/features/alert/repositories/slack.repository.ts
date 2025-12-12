import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { SlackInsert } from '../dto/slack.dto';

@Injectable()
export class SlackRepository {
  constructor(private readonly prisma: PrismaService) {}

  async insertSlackInfo(slackInsert: SlackInsert) {
    return this.prisma.slack.upsert({
      where: { id: slackInsert.user_id },
      update: {
        slack_token: slackInsert.token,
        slack_channel: slackInsert.channel,
      },
      create: {
        id: slackInsert.user_id,
        slack_token: slackInsert.token,
        slack_channel: slackInsert.channel,
      },
    });
  }

  async getUserById(state: string) {
    return await this.prisma.user.findUnique({
      where: { user_id: state },
    });
  }

  async getSlackInfoUser(user_id: string) {
    return await this.prisma.slack.findUnique({
      where: { id: user_id },
      select: { slack_token: true, slack_channel: true },
    });
  }

  async getPackageName(userwatchlist_id: string) {
    const result = await this.prisma.userWatchlist.findUnique({
      where: { id: userwatchlist_id },
      select: {
        watchlist: {
          select: {
            package: {
              select: {
                package_name: true,
              },
            },
          },
        },
      },
    });

    return result?.watchlist?.package?.package_name;
  }

  async getSlackInfoUserWatch(user_watchlist_id: string) {
    const watchlistEntry = await this.prisma.userWatchlist.findUnique({
      where: { id: user_watchlist_id },
      select: { user_id: true },
    });

    if (!watchlistEntry) return null; // handle not found

    // Then get Slack info for that user_id
    const slackInfo = await this.prisma.slack.findFirst({
      where: { id: watchlistEntry.user_id },
      select: { slack_token: true, slack_channel: true },
    });

    return slackInfo;
  }

  // Project-level Slack methods
  async insertProjectSlackInfo(projectId: string, data: {
    slack_token: string;
    slack_channel?: string | null;
  }) {
    return this.prisma.projectSlack.upsert({
      where: { project_id: projectId },
      update: {
        slack_token: data.slack_token,
        slack_channel: data.slack_channel,
      },
      create: {
        project_id: projectId,
        slack_token: data.slack_token,
        slack_channel: data.slack_channel,
      },
    });
  }

  async getProjectSlackInfo(projectId: string) {
    return await this.prisma.projectSlack.findUnique({
      where: { project_id: projectId },
      select: { slack_token: true, slack_channel: true },
    });
  }

  async deleteProjectSlackInfo(projectId: string) {
    return await this.prisma.projectSlack.delete({
      where: { project_id: projectId },
    });
  }

  // User token operations
  async updateUserSlackTokens(userId: string, accessToken: string, refreshToken: string | null) {
    return await this.prisma.user.update({
      where: { user_id: userId },
      data: {
        slack_access_token: accessToken,
        slack_refresh_token: refreshToken,
      },
    });
  }

  async getUserSlackAccessToken(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { user_id: userId },
      select: { slack_access_token: true },
    });
    return user?.slack_access_token || null;
  }

  // Project token operations
  async updateProjectSlackTokens(projectId: string, accessToken: string, refreshToken: string | null) {
    return await this.prisma.project.update({
      where: { id: projectId },
      data: {
        slack_access_token: accessToken,
        slack_refresh_token: refreshToken,
      },
    });
  }

  async getProjectSlackAccessToken(projectId: string): Promise<string | null> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { slack_access_token: true },
    });
    return project?.slack_access_token || null;
  }
}
