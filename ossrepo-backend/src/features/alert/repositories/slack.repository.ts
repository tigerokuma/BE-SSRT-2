import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { SlackInsert } from '../dto/slack.dto';

@Injectable()
export class SlackRepository {
  
  constructor(private readonly prisma: PrismaService) {}

  async insertSlackInfo(slackInsert: SlackInsert) {
    return this.prisma.slack.upsert({
        where: {id: slackInsert.userId},
        update: {
            slack_token: slackInsert.token,
            slack_channel: slackInsert.channel
        },
        create: {
            id: slackInsert.userId,
            slack_token: slackInsert.token,
            slack_channel: slackInsert.channel
        }
    });
  }

  async getUserById(state: string) {
      return await this.prisma.user.findUnique({ where: { user_id: state } });
  }

  async getSlackInfo(userId: string) {
    return await this.prisma.slack.findUnique({
      where: { id: userId },
      select: { slack_token: true, slack_channel: true },
    });

  }
}