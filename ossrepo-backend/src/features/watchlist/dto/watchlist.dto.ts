export class AddToWatchlistRequest {
  name: string;
  note?: string;
  alertsEnabled?: boolean;
}

export class UpdateWatchlistRequest {
  note?: string;
  alertsEnabled?: boolean;
}

export class WatchlistItem {
  id: string;
  name: string;
  note?: string;
  alertsEnabled: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

// Unified package response for both summary and details
export class PackageResponse {
  // Basic package info
  package_id?: string;          // Only in details
  name: string;
  description?: string;
  version?: string;
  
  // Dates
  published?: string;           // YYYY-MM-DD format for frontend
  published_at?: Date;          // Full date object for details
  last_updated?: string;        // YYYY-MM-DD format for frontend
  
  // GitHub stats
  stars?: number;
  forks?: number;
  repo_url?: string;
  repo_name?: string;           // Only in details
  contributors?: number;        // Only in details
  
  // Package metadata
  maintainers?: string[];
  keywords?: string[];
  license?: string;
  downloads?: number;           // Weekly downloads
  risk_score?: number;          // Only in details
  
  // Links
  npm_url?: string;
  homepage?: string;
} 