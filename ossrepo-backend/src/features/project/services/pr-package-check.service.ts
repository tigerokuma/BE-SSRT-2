import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class PRPackageCheckService {
  private readonly logger = new Logger(PRPackageCheckService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Check if packages are approved on the project's watchlist
   */
  async checkPRPackages(
    projectId: string,
    repositoryUrl: string,
    packageNames: string[],
  ): Promise<{
    approved: Array<{ name: string; version?: string; details: any }>;
    unapproved: string[];
    packageDetails: Record<string, any>;
  }> {
    try {
      // Find project by ID or repository URL
      const project = await this.prisma.project.findFirst({
        where: {
          OR: [
            { id: projectId },
            {
              monitoredBranch: {
                repository_url: repositoryUrl,
              },
            },
          ],
        },
        include: {
          monitoredBranch: true,
        },
      });

      if (!project) {
        this.logger.warn(`Project not found for ID: ${projectId} or URL: ${repositoryUrl}`);
        return {
          approved: [],
          unapproved: packageNames,
          packageDetails: {},
        };
      }

      // Check if GitHub Actions is enabled for this project
      if (!project.github_actions_enabled) {
        this.logger.log(`GitHub Actions not enabled for project ${project.id}`);
        return {
          approved: [],
          unapproved: packageNames,
          packageDetails: {},
        };
      }

      // Find approved packages on the watchlist
      const approvedWatchlistPackages = await this.prisma.projectWatchlistPackage.findMany({
        where: {
          project_id: project.id,
          status: 'approved',
          package: {
            name: {
              in: packageNames,
            },
          },
        },
        include: {
          package: true,
        },
      });

      // Get package details for all packages (approved and unapproved)
      const allPackages = await this.prisma.packages.findMany({
        where: {
          name: {
            in: packageNames,
          },
        },
      });

      // Get vulnerability counts for all packages
      const vulnerabilities = await this.prisma.osvVulnerability.findMany({
        where: {
          package_name: {
            in: packageNames,
          },
          is_patched: false, // Only count unpatched vulnerabilities
        },
        select: {
          package_name: true,
        },
      });

      // Count vulnerabilities per package
      const vulnerabilityCounts: Record<string, number> = {};
      vulnerabilities.forEach((vuln) => {
        vulnerabilityCounts[vuln.package_name] = (vulnerabilityCounts[vuln.package_name] || 0) + 1;
      });

      // Create a map of package details
      const packageDetailsMap: Record<string, any> = {};
      allPackages.forEach((pkg) => {
        const vulnCount = vulnerabilityCounts[pkg.name] || 0;
        packageDetailsMap[pkg.name] = {
          id: pkg.id,
          name: pkg.name,
          healthScore: pkg.total_score,
          activityScore: pkg.activity_score,
          busFactorScore: pkg.bus_factor_score,
          vulnerabilityScore: pkg.vulnerability_score,
          scorecardScore: pkg.scorecard_score,
          license: pkg.license,
          stars: pkg.stars,
          contributors: pkg.contributors,
          repoUrl: pkg.repo_url,
          hasVulnerabilities: vulnCount > 0,
          vulnerabilityCount: vulnCount,
        };
      });

      // Also include packages that weren't found in Packages table but might have vulnerabilities
      for (const pkgName of packageNames) {
        if (!packageDetailsMap[pkgName]) {
          const vulnCount = vulnerabilityCounts[pkgName] || 0;
          packageDetailsMap[pkgName] = {
            name: pkgName,
            healthScore: null,
            hasVulnerabilities: vulnCount > 0,
            vulnerabilityCount: vulnCount,
          };
        }
      }

      // Separate approved and unapproved packages
      const approvedNames = new Set(
        approvedWatchlistPackages.map((wp) => wp.package.name),
      );
      const approved = approvedWatchlistPackages.map((wp) => ({
        name: wp.package.name,
        version: undefined, // Version not stored in watchlist, would need to get from PR diff
        details: packageDetailsMap[wp.package.name] || {},
      }));

      const unapproved = packageNames.filter((name) => !approvedNames.has(name));

      this.logger.log(
        `Checked ${packageNames.length} packages: ${approved.length} approved, ${unapproved.length} unapproved`,
      );

      return {
        approved,
        unapproved,
        packageDetails: packageDetailsMap,
      };
    } catch (error) {
      this.logger.error('Error checking PR packages:', error);
      throw error;
    }
  }
}

