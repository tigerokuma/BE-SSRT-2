import { Injectable } from '@nestjs/common';
import { WatchlistRepository } from '../repositories/watchlist.repository';
import {
  AddToWatchlistRequest,
  UpdateWatchlistRequest,
} from '../dto/watchlist.dto';

@Injectable()
export class WatchlistService {
  constructor(private readonly watchlistRepository: WatchlistRepository) {}

  async getWatchlist(userId?: string) {
    // Get user's watchlist items with package details and enriched data
    const userWatchlist = await this.watchlistRepository.getWatchlist(userId);
    
    // Transform the data to match frontend expectations
    return userWatchlist.map(item => ({
      id: item.id,
      watchlist_id: item.watchlist.watchlist_id, // Add watchlist_id for status checking
      name: item.watchlist.package.package_name,
      repo_url: item.watchlist.package.repo_url,
      description: item.watchlist.package.description,
      version: item.watchlist.package.version,
      downloads: item.downloads, // Use enriched data from repository
      stars: item.stars, // Use enriched data from repository
      forks: item.forks, // Use enriched data from repository
      contributors: item.contributors, // Use enriched data from repository
      risk_score: item.watchlist.package.risk_score,
      last_updated: item.watchlist.package.last_updated,
      notes: item.notes,
      alerts: item.alerts ? JSON.parse(item.alerts) : null,
      added_at: item.added_at,
      status: item.watchlist.status, // This is already the status from the database!
      processing_started_at: item.watchlist.processing_started_at,
      processing_completed_at: item.watchlist.processing_completed_at,
      last_error: item.watchlist.last_error,
      // New enriched data fields
      notification_count: item.alertCount || 0, // Number of alerts triggered
      activity_score: item.activityScore || null, // Activity score from ActivityData
      bus_factor: item.busFactor || null, // Bus factor from BusFactorData
      health_score: item.healthScore || null, // Health score from HealthData
      tracking_duration: item.trackingDuration || '0 days' // How long tracking
    }));
  }

  async addToWatchlist(request: AddToWatchlistRequest) {
    // TODO: Implement add to watchlist logic
    // - Validate package exists
    // - Check for duplicates
    // - Create watchlist entry
    // - Return success response
    return this.watchlistRepository.addToWatchlist(request);
  }

  async updateWatchlistItem(id: string, request: UpdateWatchlistRequest) {
    // TODO: Implement watchlist item update logic
    // - Validate item exists
    // - Update notes and alert preferences
    // - Return updated item
    return this.watchlistRepository.updateWatchlistItem(id, request);
  }

  async importFromGithub(repoUrl: string) {
    // TODO: Implement GitHub import logic
    // - Parse repository URL
    // - Fetch dependency files (package.json, etc.)
    // - Extract package names
    // - Add to watchlist in bulk
    // - Return import summary
    return this.watchlistRepository.importFromGithub(repoUrl);
  }
}
