import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class AlertCentreRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getAlert(ID: string) {
    return await this.prisma.alert.findMany({
        where: {id: ID},
    });
  }

  async getUserAlerts(user_watchlist_id: string) {
    return await this.prisma.alertTriggered.findMany({
        where: {user_watchlist_id: user_watchlist_id},
        orderBy: {
          created_at: 'desc'
        }
    });
  }

}
