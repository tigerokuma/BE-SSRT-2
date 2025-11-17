import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';

export interface AlertSettingsDto {
  anomaly_threshold: number; // 0-100
  vulnerability_threshold: string; // "low" | "medium" | "high" | "critical"
}

@Injectable()
export class PackageAlertSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get alert settings for a package in a project
   * Returns default values if no settings exist
   */
  async getAlertSettings(
    projectId: string,
    packageId: string,
  ): Promise<AlertSettingsDto> {
    const settings = await this.prisma.projectPackageAlertSettings.findUnique({
      where: {
        project_id_package_id: {
          project_id: projectId,
          package_id: packageId,
        },
      },
    });

    if (!settings) {
      // Return default values
      return {
        anomaly_threshold: 50.0,
        vulnerability_threshold: 'medium',
      };
    }

    return {
      anomaly_threshold: settings.anomaly_threshold,
      vulnerability_threshold: settings.vulnerability_threshold,
    };
  }

  /**
   * Update or create alert settings for a package in a project
   */
  async updateAlertSettings(
    projectId: string,
    packageId: string,
    settings: AlertSettingsDto,
  ): Promise<AlertSettingsDto> {
    // Validate anomaly_threshold
    if (
      settings.anomaly_threshold < 0 ||
      settings.anomaly_threshold > 100
    ) {
      throw new Error('Anomaly threshold must be between 0 and 100');
    }

    // Validate vulnerability_threshold
    const validThresholds = ['low', 'medium', 'high', 'critical'];
    if (!validThresholds.includes(settings.vulnerability_threshold)) {
      throw new Error(
        `Vulnerability threshold must be one of: ${validThresholds.join(', ')}`,
      );
    }

    // Verify project and package exist
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) {
      throw new NotFoundException(`Project with ID '${projectId}' not found`);
    }

    const package_ = await this.prisma.packages.findUnique({
      where: { id: packageId },
    });
    if (!package_) {
      throw new NotFoundException(`Package with ID '${packageId}' not found`);
    }

    // Upsert settings
    const updated = await this.prisma.projectPackageAlertSettings.upsert({
      where: {
        project_id_package_id: {
          project_id: projectId,
          package_id: packageId,
        },
      },
      update: {
        anomaly_threshold: settings.anomaly_threshold,
        vulnerability_threshold: settings.vulnerability_threshold,
      },
      create: {
        project_id: projectId,
        package_id: packageId,
        anomaly_threshold: settings.anomaly_threshold,
        vulnerability_threshold: settings.vulnerability_threshold,
      },
    });

    return {
      anomaly_threshold: updated.anomaly_threshold,
      vulnerability_threshold: updated.vulnerability_threshold,
    };
  }
}

