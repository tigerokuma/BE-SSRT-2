import { Injectable } from '@nestjs/common';
import { AddToWatchlistRequest, UpdateWatchlistRequest } from '../dto/watchlist.dto';
import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class WatchlistRepository {
  constructor(private readonly prisma: PrismaService) {}

  async getWatchlist(user_id: string) {
    // Get all UserWatchlist entries for the user, including the related Watchlist and Package
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
    // Find the package by name
    const pkg = await this.prisma.package.findUnique({ where: { package_name: request.name } });
    if (!pkg) throw new Error('Package not found');

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
    // Update notes and alerts for the UserWatchlist entry
    return this.prisma.userWatchlist.update({
      where: { id },
      data: {
        notes: request.note,
        alerts: request.alertsEnabled ? 'enabled' : 'disabled',
      },
    });
  }

  async deleteWatchlistItem(user_id: string, id: string) {
    // Delete the UserWatchlist entry
    return this.prisma.userWatchlist.delete({ where: { id } });
  }
} 