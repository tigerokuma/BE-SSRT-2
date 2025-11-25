import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class ProjectAlertService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get alerts for a specific project (ProjectAlert table - project-level alerts)
   */
  async getProjectAlerts(
    projectId: string,
    filters?: {
      alertType?: string;
      status?: string;
      packageId?: string;
    },
  ) {
    const where: any = {
      project_id: projectId,
    };

    if (filters?.alertType && filters.alertType !== 'all') {
      where.alert_type = filters.alertType;
    }

    if (filters?.status && filters.status !== 'all') {
      where.status = filters.status;
    }

    if (filters?.packageId) {
      where.package_id = filters.packageId;
    }

    const alerts = await this.prisma.projectAlert.findMany({
      where,
      include: {
        package: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        detected_at: 'desc',
      },
    });

    return alerts;
  }

  /**
   * Get package alerts (ProjectPackageAlert) for packages in this project's branch dependencies
   */
  async getProjectPackageAlerts(
    projectId: string,
    filters?: {
      alertType?: string;
      status?: string;
    },
  ) {
    // Get the project's monitored branch
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { monitored_branch_id: true },
    });

    if (!project || !project.monitored_branch_id) {
      return [];
    }

    // Get all branch dependencies for this project
    const branchDependencies = await this.prisma.branchDependency.findMany({
      where: {
        monitored_branch_id: project.monitored_branch_id,
      },
      select: {
        package_id: true,
      },
    });

    const packageIds = branchDependencies
      .map(d => d.package_id)
      .filter((id): id is string => id !== null);

    if (packageIds.length === 0) {
      return [];
    }

    // Build where clause
    const where: any = {
      project_id: projectId,
      package_id: {
        in: packageIds,
      },
    };

    if (filters?.alertType && filters.alertType !== 'all') {
      where.alert_type = filters.alertType;
    }

    if (filters?.status && filters.status !== 'all') {
      where.status = filters.status;
    }

    // Fetch ProjectPackageAlert records
    const packageAlerts = await this.prisma.projectPackageAlert.findMany({
      where,
      include: {
        package: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        detected_at: 'desc',
      },
    });

    return packageAlerts;
  }

  /**
   * Update alert status (handles both ProjectAlert and ProjectPackageAlert)
   */
  async updateAlertStatus(
    alertId: string,
    status: 'unread' | 'read' | 'resolved',
  ) {
    // Try ProjectAlert first
    const projectAlert = await this.prisma.projectAlert.findUnique({
      where: { id: alertId },
    });

    if (projectAlert) {
      return this.prisma.projectAlert.update({
        where: { id: alertId },
        data: { status },
      });
    }

    // Try ProjectPackageAlert
    const packageAlert = await this.prisma.projectPackageAlert.findUnique({
      where: { id: alertId },
    });

    if (packageAlert) {
      return this.prisma.projectPackageAlert.update({
        where: { id: alertId },
        data: { status },
      });
    }

    throw new NotFoundException(`Alert with id ${alertId} not found`);
  }
}

