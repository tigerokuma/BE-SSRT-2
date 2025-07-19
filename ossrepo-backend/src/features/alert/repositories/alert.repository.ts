import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CreateAlertDto, UpdateAlertDto } from '../dto/create-alert.dto';

@Injectable()
export class AlertCentreRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getAlert(ID: string) {
    return await this.prisma.alert.findMany({
        where: {id: ID},
    });
  }

  async createAlert(ID: string, createAlertDto: CreateAlertDto) {
    const latestAlert = await this.prisma.alert.findFirst({
        where: { id: ID },
        orderBy: { alert_id: 'desc' },
        select: { alert_id: true },
      });

    const newAlertId = latestAlert ? latestAlert.alert_id + 1 : 1;

    return this.prisma.alert.create({ data: {
     alert_id: newAlertId.toString(),
     id: ID,
     risk: createAlertDto.risk,
     status: createAlertDto.status,
     title: createAlertDto.title,
     description: createAlertDto.description,
    } });
  }

  async updateGeneralAlert(alertID: string, updateAlertDto: UpdateAlertDto) {
    return this.prisma.alert.updateMany({
      where: { alert_id: alertID },
      data: updateAlertDto,
    });
  }

  async deleteGeneralAlert(alert_id: string) {
    return this.prisma.alert.deleteMany({
      where: { alert_id },
    });
  }
}
