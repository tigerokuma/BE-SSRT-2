import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { WatchlistService } from '../services/watchlist.service';
import { AddToWatchlistRequest, UpdateWatchlistRequest } from '../dto/watchlist.dto';

@Controller('watchlist')
export class WatchlistController {
  constructor(private readonly watchlistService: WatchlistService) {}

  @Get()
  async getWatchlist(@Query('user_id') user_id: string) {
    return this.watchlistService.getWatchlist(user_id);
  }

  @Post()
  async addToWatchlist(@Body() request: AddToWatchlistRequest & { user_id: string }) {
    return this.watchlistService.addToWatchlist(request.user_id, request);
  }

  @Patch(':id')
  async updateWatchlistItem(
    @Param('id') id: string,
    @Body() request: UpdateWatchlistRequest & { user_id: string }
  ) {
    return this.watchlistService.updateWatchlistItem(request.user_id, id, request);
  }

  @Delete(':id')
  async deleteWatchlistItem(
    @Param('id') id: string,
    @Body() body: { user_id: string }
  ) {
    return this.watchlistService.deleteWatchlistItem(body.user_id, id);
  }
} 