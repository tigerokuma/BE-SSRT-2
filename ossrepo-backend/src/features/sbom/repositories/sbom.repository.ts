import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { Prisma } from 'generated/prisma';
import { CreateSbomDto, UpdateSbomDto } from '../dto/sbom.dto';

@Injectable()
export class SbomRepository {
  constructor(private prisma: PrismaService) {}

  async upsertWatchSbom(data: CreateSbomDto) {
    const mappedData = {
      watchlist_id: data.id,
      sbom: data.sbom,
    };

    return await this.prisma.watchlistSbom.upsert({
      where: { watchlist_id: mappedData.watchlist_id }, 
      update: { sbom: mappedData.sbom, updated_at: new Date() }, 
      create: mappedData, 
    });
  }
  
  async upsertUserSbom(data: CreateSbomDto) {
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

  async getUrl(id: string) {
    const packageId = await this.prisma.watchlist.findUnique({
      where: { watchlist_id: id},
      select: { package_id: true }
    });
    return await this.prisma.package.findUnique({
      where: { package_id: packageId?.package_id },
      select: { repo_url: true }
    });
  }

  async getWatchSbom(id: string) {
    return await this.prisma.watchlistSbom.findUnique({ 
      where: { watchlist_id: id },
      select: { sbom: true, updated_at: true }
    });
  }

  async getUserSbom(id: string) {
    return await this.prisma.userWatchlistSbom.findUnique({ 
      where: { user_id: id },
      select: { sbom: true, updated_at: true }
    });
  }

  async getFollowSboms(user_id: string) {
    const watchlists =  await this.prisma.userWatchlist.findMany({
      where: { user_id },
      select: { watchlist_id: true }
    });

    const watchlist_ids = (await watchlists).map(w => w.watchlist_id);

    return await this.prisma.watchlistSbom.findMany({
      where: { watchlist_id: { in: watchlist_ids } },
      select: { sbom: true }
    })
  }

  async getWatchFollows(user_id: string) {
    const watchlists = await this.prisma.userWatchlist.findMany({
      where: { user_id },
      select: {
        watchlist_id: true,
        watchlist: {
          select: { package: { select: { package_name: true } } }
        }
      }
    });

    return watchlists.map(w => ({
      watchlist_id: w.watchlist_id,
      package_name: w.watchlist.package.package_name
    }));

  }

}
