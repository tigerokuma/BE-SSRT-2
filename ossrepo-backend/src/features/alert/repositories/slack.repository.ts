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
}
