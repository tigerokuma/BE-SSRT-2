import { Injectable } from '@nestjs/common';
import { WatchlistRepository } from '../repositories/watchlist.repository';
import { AddToWatchlistRequest, UpdateWatchlistRequest } from '../dto/watchlist.dto';

@Injectable()
export class WatchlistService {
  constructor(private readonly watchlistRepository: WatchlistRepository) {}

  async getWatchlist(user_id: string) {
    return this.watchlistRepository.getWatchlist(user_id);
  }

  async addToWatchlist(user_id: string, request: AddToWatchlistRequest) {
    return this.watchlistRepository.addToWatchlist(user_id, request);
  }

  async updateWatchlistItem(user_id: string, id: string, request: UpdateWatchlistRequest) {
    return this.watchlistRepository.updateWatchlistItem(user_id, id, request);
  }

  async deleteWatchlistItem(user_id: string, id: string) {
    return this.watchlistRepository.deleteWatchlistItem(user_id, id);
  }
} 