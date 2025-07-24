import { Injectable } from '@nestjs/common';
import { AddToWatchlistRequest, UpdateWatchlistRequest } from '../dto/watchlist.dto';
import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class WatchlistRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getWatchlist(user_id: string) {
    return this.prisma.userWatchlist.findMany({
      where: { user_id },
      include: {
        watchlist: {
          include: {
            package: true,
          },
        },
      },
    });
  }

  async addToWatchlist(user_id: string, request: AddToWatchlistRequest) {
    // Try to find the package in the Package table
    let pkg = await this.prisma.package.findUnique({ where: { package_name: request.name } });
    // If not found, try to import from NpmPackage
    if (!pkg) {
      const npmPkg = await this.prisma.npmPackage.findUnique({ where: { package_name: request.name } });
      if (!npmPkg) throw new Error('Package not found');
      // Create a new Package record from NpmPackage fields
      pkg = await this.prisma.package.create({
        data: {
          package_name: npmPkg.package_name,
          description: npmPkg.description,
          version: npmPkg.version,
          downloads: npmPkg.downloads,
          keywords: npmPkg.keywords,
          license: npmPkg.license,
          npm_url: npmPkg.npm_url,
          homepage: npmPkg.homepage,
          published_at: npmPkg.published_at,
          last_updated: npmPkg.last_updated,
          maintainers: npmPkg.maintainers,
          risk_score: npmPkg.risk_score,
          repo_url: npmPkg.repo_url ?? '',
          repo_name: npmPkg.repo_url ?? '', // fallback, you may want to parse repo_name
          fetched_at: npmPkg.fetched_at,
        },
      });
    }

    // Check for duplicate
    const existing = await this.prisma.userWatchlist.findFirst({
      where: { user_id, watchlist: { package_id: pkg.package_id } },
    });
    if (existing) throw new Error('Already in watchlist');

    // Create Watchlist entry if not exists
    let watchlist = await this.prisma.watchlist.findFirst({ where: { package_id: pkg.package_id } });
    if (!watchlist) {
      watchlist = await this.prisma.watchlist.create({
        data: {
          package_id: pkg.package_id,
          alert_cve_ids: [],
        },
      });
    }

    // Create UserWatchlist entry
    return this.prisma.userWatchlist.create({
      data: {
        user_id,
        watchlist_id: watchlist.watchlist_id,
        notes: request.note,
        alerts: request.alertsEnabled ? 'enabled' : 'disabled',
      },
      include: {
        watchlist: {
          include: { package: true },
        },
      },
    });
  }

  async updateWatchlistItem(user_id: string, id: string, request: UpdateWatchlistRequest) {
    return this.prisma.userWatchlist.update({
      where: { id },
      data: {
        notes: request.note,
        alerts: request.alertsEnabled ? 'enabled' : 'disabled',
      },
    });
  }

  async deleteWatchlistItem(user_id: string, id: string) {
    return this.prisma.userWatchlist.delete({ where: { id } });
  }
} 