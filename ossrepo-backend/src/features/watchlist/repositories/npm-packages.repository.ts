import { Injectable } from '@nestjs/common';
import { NpmPackage } from 'generated/prisma';
import { PrismaService } from 'src/common/prisma/prisma.service';

@Injectable()
export class NpmPackagesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByName(packageName: string): Promise<NpmPackage | null> {
    return this.prisma.npmPackage.findUnique({
      where: { package_name: packageName }
    });
  }

  async searchByName(name: string): Promise<NpmPackage[]> {
    return this.prisma.npmPackage.findMany({
      where: {
        package_name: { contains: name, mode: 'insensitive' }
      },
      orderBy: [
        { downloads: 'desc' },
        { fetched_at: 'desc' }
      ],
      take: 10
    });
  }

  async createOrUpdate(packageData: Partial<NpmPackage>): Promise<NpmPackage> {
    return this.prisma.npmPackage.upsert({
      where: { package_name: packageData.package_name! },
      update: {
        description: packageData.description,
        version: packageData.version,
        downloads: packageData.downloads,
        keywords: packageData.keywords || [],
        license: packageData.license,
        npm_url: packageData.npm_url,
        homepage: packageData.homepage,
        published_at: packageData.published_at,
        last_updated: packageData.last_updated,
        maintainers: packageData.maintainers || [],
        risk_score: packageData.risk_score,
        repo_url: packageData.repo_url,
        fetched_at: new Date()
      },
      create: {
        package_name: packageData.package_name!,
        description: packageData.description,
        version: packageData.version,
        downloads: packageData.downloads,
        keywords: packageData.keywords || [],
        license: packageData.license,
        npm_url: packageData.npm_url,
        homepage: packageData.homepage,
        published_at: packageData.published_at,
        last_updated: packageData.last_updated,
        maintainers: packageData.maintainers || [],
        risk_score: packageData.risk_score,
        repo_url: packageData.repo_url,
        fetched_at: new Date()
      }
    });
  }

  async isDataFresh(fetchedAt: Date | null): Promise<boolean> {
    if (!fetchedAt) return false;
    const hoursAgo = (Date.now() - fetchedAt.getTime()) / (1000 * 60 * 60);
    return hoursAgo < 12; // Fresh if less than 12 hours old
  }
} 