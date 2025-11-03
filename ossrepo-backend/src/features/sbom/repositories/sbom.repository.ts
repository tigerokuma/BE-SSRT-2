import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { Prisma } from 'generated/prisma';
import { CreateSbomDto, UpdateSbomDto } from '../dto/sbom.dto';

@Injectable()
export class SbomRepository {
  constructor(private prisma: PrismaService) {}


  async upsertPackageSbom(data: CreateSbomDto) {
    // Get package info from Packages table
    const packageId = data.id;
    const pkg = await this.prisma.packages.findUnique({
      where: { id: packageId },
      select: { name: true, repo_url: true, license: true },
    });

    if (!pkg) {
      throw new Error(`Package ${packageId} not found`);
    }

    // Find or create Package entry (old table) using name
    let packageEntry = await this.prisma.package.findUnique({
      where: { package_name: pkg.name },
    });

    if (!packageEntry) {
      // Create Package entry if it doesn't exist
      packageEntry = await this.prisma.package.create({
        data: {
          package_name: pkg.name,
          repo_url: pkg.repo_url || '',
          repo_name: pkg.name,
          license: pkg.license,
          keywords: [],
          maintainers: [],
        },
      });
    }

    // Check if watchlist exists for this package
    const existingWatchlist = await this.prisma.watchlist.findFirst({
      where: { package_id: packageEntry.package_id },
    });

    let watchlistId: string;
    if (existingWatchlist) {
      watchlistId = existingWatchlist.watchlist_id;
    } else {
      // Create watchlist entry
      const newWatchlist = await this.prisma.watchlist.create({
        data: {
          package_id: packageEntry.package_id,
          alert_cve_ids: [],
          status: 'processing',
        },
      });
      watchlistId = newWatchlist.watchlist_id;
    }

    // Now upsert the SBOM data
    return await this.prisma.watchlistSbom.upsert({
      where: { watchlist_id: watchlistId },
      update: { sbom: data.sbom, updated_at: new Date() },
      create: { watchlist_id: watchlistId, sbom: data.sbom },
    });
  }

  async upsertProjectSbom(data: CreateSbomDto) {
    // Map project_id to user_id for storage
    const mappedData = {
      user_id: data.id,
      sbom: data.sbom,
    };

    return await this.prisma.userWatchlistSbom.upsert({
      where: { user_id: mappedData.user_id },
      update: { sbom: mappedData.sbom, updated_at: new Date() },
      create: mappedData,
    });
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
    // Get package from Packages table
    const pkg = await this.prisma.packages.findUnique({
      where: { id },
      select: { name: true },
    });

    if (!pkg) {
      return null;
    }

    // Find the corresponding Package entry
    const packageEntry = await this.prisma.package.findUnique({
      where: { package_name: pkg.name },
      select: { package_id: true },
    });

    if (!packageEntry) {
      return null;
    }

    // Find the watchlist for this package
    const watchlist = await this.prisma.watchlist.findFirst({
      where: { package_id: packageEntry.package_id },
      select: { watchlist_id: true },
    });

    if (!watchlist) {
      return null;
    }

    // Return the SBOM data
    return await this.prisma.watchlistSbom.findUnique({
      where: { watchlist_id: watchlist.watchlist_id },
      select: { sbom: true, updated_at: true },
    });
  }

  async getProjectSbom(id: string) {
    return await this.prisma.userWatchlistSbom.findUnique({
      where: { user_id: id },
      select: { sbom: true, updated_at: true },
    });
  }

  async getProjectDependencySboms(projectId: string) {
    // Get all project dependencies for a project through project_dependencies table
    const projectDeps = await this.prisma.project_dependencies.findMany({
      where: { project_id: projectId },
      include: { 
        Package: {
          select: { package_name: true }
        }
      },
    });

    // Get corresponding watchlist IDs for these packages
    const packageNames = projectDeps
      .map((dep) => dep.Package?.package_name)
      .filter((name): name is string => name !== null && name !== undefined);

    if (packageNames.length === 0) {
      return [];
    }

    // Find all Package entries for these package names
    const packageEntries = await this.prisma.package.findMany({
      where: { package_name: { in: packageNames } },
      select: { package_id: true },
    });

    const packageIds = packageEntries.map(p => p.package_id);

    // Find watchlists for these packages
    const watchlists = await this.prisma.watchlist.findMany({
      where: { package_id: { in: packageIds } },
      select: { watchlist_id: true },
    });

    const watchlistIds = watchlists.map(w => w.watchlist_id);

    if (watchlistIds.length === 0) {
      return [];
    }

    return await this.prisma.watchlistSbom.findMany({
      where: { watchlist_id: { in: watchlistIds } },
      select: { sbom: true },
    });
  }

  async getProjectDependencies(projectId: string) {
    // Get all project dependencies for a project
    const projectDeps = await this.prisma.project_dependencies.findMany({
      where: { project_id: projectId },
      select: {
        package_id: true,
        name: true,
      },
    });

    return projectDeps
      .filter((dep) => dep.package_id !== null)
      .map((dep) => ({
        package_id: dep.package_id!,
        package_name: dep.name,
      }));
  }

  async getProjectWatchlist(projectId: string) {
    // Get all watchlist packages for a project
    const watchlistDeps = await this.prisma.projectWatchlistPackage.findMany({
      where: { project_id: projectId },
      select: {
        package_id: true,
        package: {
          select: {
            name: true,
          },
        },
      },
    });

    return watchlistDeps
      .filter((item) => item.package_id !== null && item.package !== null)
      .map((item) => ({
        package_id: item.package_id!,
        package_name: item.package!.name,
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
    const watchlist = await this.prisma.packages.findUnique({
      where: { id: packageId },
      select: {
        id: true,
        name: true,
        license: true,
      },
    });
    return watchlist;
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
}
