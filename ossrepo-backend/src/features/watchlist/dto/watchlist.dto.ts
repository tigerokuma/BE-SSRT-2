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

// NPM-style summary with enhanced GitHub data
export class PackageSummary {
  name: string;
  description?: string;
  version?: string;
  published?: string;           // Published date as string (YYYY-MM-DD)
  
  // GitHub stats (very useful for developers)
  stars?: number;              // GitHub stars
  forks?: number;              // GitHub forks 
  repo_url?: string;           // GitHub repository URL
  
  // Package metadata
  maintainers?: string[];
  keywords?: string[];
  license?: string;            // License type (MIT, Apache, etc.)
  downloads?: number;          // Weekly downloads
  
  // Links
  npm_url?: string;            // https://npm.im/package-name
  homepage?: string;           // Project homepage/documentation
  
  // Freshness indicators
  last_updated?: string;       // Last updated date (YYYY-MM-DD)
}

export class PackageDetails {
  package_id: string;
  name: string;
  description?: string;
  version?: string;
  repo_url: string;
  repo_name: string;
  stars?: number;
  downloads?: number;
  contributors?: number;
  risk_score?: number;
  published_at?: Date;
  last_updated?: Date;
  maintainers?: string[];
  keywords?: string[];
  npm_url?: string;
  homepage?: string;
  license?: string;
} 