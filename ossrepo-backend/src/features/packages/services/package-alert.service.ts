import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class PackageAlertService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get alerts for a specific package in a project
   */
  async getPackageAlerts(projectId: string, packageId: string) {
    const alerts = await this.prisma.projectPackageAlert.findMany({
      where: {
        project_id: projectId,
        package_id: packageId,
      },
      orderBy: {
        detected_at: 'desc',
      },
    });

    return alerts;
  }

  /**
   * Update alert status
   */
  async updateAlertStatus(
    alertId: string,
    status: 'unread' | 'read' | 'resolved',
  ) {
    const alert = await this.prisma.projectPackageAlert.findUnique({
      where: { id: alertId },
    });

    if (!alert) {
      throw new NotFoundException(`Alert with id ${alertId} not found`);
    }

    return this.prisma.projectPackageAlert.update({
      where: { id: alertId },
      data: { status },
    });
  }
}

