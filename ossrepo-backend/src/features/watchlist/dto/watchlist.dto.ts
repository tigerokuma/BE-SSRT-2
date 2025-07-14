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

// Clean DTOs for package responses
export class PackageCardDto {
  name: string;
  description: string;
  keywords: string[];
  downloads: number;
  maintainers: string[];
  last_updated: string;
  version: string;
  license: string;
  
  // GitHub fields (may be null for fast NPM-only responses)
  stars?: number | null;
  forks?: number | null;
  contributors?: number | null;
}

export class PackageDetailsDto extends PackageCardDto {
  package_id: string;
  published: string;
  published_at: Date;
  repo_url: string;
  repo_name: string;
  risk_score: number;
  npm_url: string;
  homepage: string;
} 