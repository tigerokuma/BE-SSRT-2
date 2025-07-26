import { Controller, Get, Post, Patch, Body, Param, Query } from '@nestjs/common';
import { WatchlistService } from '../services/watchlist.service';
import {
  AddToWatchlistRequest,
  UpdateWatchlistRequest,
} from '../dto/watchlist.dto';

@Controller('watchlist')
export class WatchlistController {
  constructor(private readonly watchlistService: WatchlistService) {}

  @Get()
  async getWatchlist(@Query('userId') userId?: string) {
    return this.watchlistService.getWatchlist(userId);
  }

  @Get(':id/details')
  async getWatchlistItemDetails(@Param('id') id: string) {
    return this.watchlistService.getWatchlistItemDetails(id);
  }

  @Post()
  async addToWatchlist(@Body() request: AddToWatchlistRequest) {
    // TODO: Implement adding package to watchlist
    return this.watchlistService.addToWatchlist(request);
  }

  @Patch(':id')
  async updateWatchlistItem(
    @Param('id') id: string,
    @Body() request: UpdateWatchlistRequest,
  ) {
    // TODO: Implement watchlist item update
    return this.watchlistService.updateWatchlistItem(id, request);
  }

  @Post('import/github')
  async importFromGithub(@Body() request: { repoUrl: string }) {
    // TODO: Implement GitHub repository dependency import
    return this.watchlistService.importFromGithub(request.repoUrl);
  }
}
