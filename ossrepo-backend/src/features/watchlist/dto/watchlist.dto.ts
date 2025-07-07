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

export class PackageSummary {
  name: string;
  version: string;
  downloads: number;
  lastUpdated: string;
  riskScore: number;
  trustedByOrgs: string;
}

export class PackageDetails {
  name: string;
  riskHistory: Array<{
    date: string;
    score: number;
  }>;
  changelog: string[];
  maintainerStats: {
    contributors: number;
    maintainerActivity: string;
  };
} 