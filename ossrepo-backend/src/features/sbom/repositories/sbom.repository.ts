import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { Prisma } from 'generated/prisma';
import { CreateSbomDto, UpdateSbomDto } from '../dto/sbom.dto';

@Injectable()
export class SbomRepository {
  constructor(private prisma: PrismaService) {}


  async upsertPackageSbom(data: CreateSbomDto) {
    // SBOMs are stored in Memgraph only, not in Prisma database
    // This method is kept for backward compatibility but does nothing
    return null;
  }

  async upsertProjectSbom(data: CreateSbomDto) {
    // SBOMs are stored in Memgraph only, not in Prisma database
    // This method is kept for backward compatibility but does nothing
    return null;
  }

  async getUrl(packageId: string) {
    // Get package directly from Packages table
    const pkg = await this.prisma.packages.findUnique({
      where: { id: packageId },
      select: { repo_url: true }
    });

    if (pkg?.repo_url) {
      return { repo_url: pkg.repo_url };
    }

    return null;
  }

  async getPackageSbom(id: string) {
    // SBOMs are stored in Memgraph only, not in Prisma database
    return null;
  }
  async upsertPackage(packageName: string, repoUrl: string, license: string) {
    return await this.prisma.packages.upsert({
      where: { name: packageName },
      update: { repo_url: repoUrl, license: license },
      create: { name: packageName, repo_url: repoUrl, license: license },
    });
  }

  async getProjectSbom(id: string) {
    // SBOMs are stored in Memgraph only, not in Prisma database
    return null;
  }

  async getProjectDependencySboms(projectId: string) {
    // SBOMs are stored in Memgraph only, not in Prisma database
    // Return empty array as SBOMs should be retrieved from Memgraph
    return [];
  }

  async getProjectDependencies(projectId: string) {
    // First, get the project to find its monitored branch
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        monitored_branch_id: true,
      },
    });

    // Get branch dependencies from the monitored branch (these are the actual project dependencies)
    if (project?.monitored_branch_id) {
      const branchDeps = await this.prisma.branchDependency.findMany({
        where: { monitored_branch_id: project.monitored_branch_id },
        select: {
          package_id: true,
          name: true,
          version: true,
        },
      });

      return branchDeps
        .filter((dep) => dep.package_id !== null)
        .map((dep) => ({
          package_id: dep.package_id!,
          package_name: dep.name,
          version: dep.version,
        }));
    }

    // Fallback to project_dependencies if no monitored branch
    const projectDeps = await this.prisma.project_dependencies.findMany({
      where: { project_id: projectId },
      select: {
        package_id: true,
        name: true,
        version: true,
      },
    });

    return projectDeps
      .filter((dep) => dep.package_id !== null)
      .map((dep) => ({
        package_id: dep.package_id!,
        package_name: dep.name,
        version: dep.version,
      }));
  }

  
  async getProjectInfo(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        description: true,
        license: true,
      },
    });
    return project;
  }

  async getPackageInfo(packageId: string) {
    const pkg = await this.prisma.packages.findUnique({
      where: { id: packageId },
      select: {
        id: true,
        name: true,
        license: true,
      },
    });
    return pkg;
  }

  // --- Find package by name (read-only) ---
  async findPackageByName(packageName: string): Promise<{ id: string } | null> {
    try {
      const dbPackage = await this.prisma.packages.findUnique({
        where: { name: packageName },
        select: { id: true },
      });
      return dbPackage;
    } catch (error) {
      console.error(`Error finding package ${packageName}:`, error);
      return null;
    }
  }

  // --- Upsert package from SBOM component ---
  // This method receives already-extracted package data and just handles the database upsert
  async upsertPackageFromSbomComponent(
    packageName: string,
    repoUrl: string | null,
    license: string | null
  ): Promise<string | null> {
    try {
      const dbPackage = await this.prisma.packages.upsert({
        where: { name: packageName },
        update: {
          ...(repoUrl && { repo_url: repoUrl }),
          ...(license && { license }),
        },
        create: {
          name: packageName,
          repo_url: repoUrl,
          license,
          status: 'queued',
        },
      });
      return dbPackage.id;
    } catch (error) {
      console.error(`Error upserting package ${packageName}:`, error);
      return null;
    }
  }

  async getPackageRiskScore(packageName: string): Promise<number | null> {
    try {
      // Get total_score from Packages table and invert to risk score
      const pkg = await this.prisma.packages.findUnique({
        where: { name: packageName },
        select: { total_score: true },
      });
      
      if (pkg?.total_score !== null && pkg?.total_score !== undefined) {
        // Invert total_score (health score) to risk score
        // Health score: higher is better (0-100)
        // Risk score: higher is worse (0-100)
        return 100 - pkg.total_score;
      }
      
      return null;
    } catch (error) {
      console.error(`Error fetching risk score for package ${packageName}:`, error);
      return null;
    }
  }

  async getPackageTotalScore(packageName: string): Promise<number | null> {
    try {
      // Get total_score from the new Packages table
      const newPackage = await this.prisma.packages.findUnique({
        where: { name: packageName },
        select: { total_score: true },
      });
      
      if (newPackage?.total_score !== null && newPackage?.total_score !== undefined) {
        return newPackage.total_score;
      }
      
      return null;
    } catch (error) {
      console.error(`Error fetching total score for package ${packageName}:`, error);
      return null;
    }
  }

  async getPackageById(packageId: string) {
    // Get package from Packages table
    const packageEntry = await this.prisma.packages.findUnique({
      where: { id: packageId },
      select: {
        id: true,
        name: true,
      },
    });
    
    if (packageEntry) {
      return {
        package_id: packageEntry.id,
        package_name: packageEntry.name,
      };
    }
    
    return null;
  }
}
