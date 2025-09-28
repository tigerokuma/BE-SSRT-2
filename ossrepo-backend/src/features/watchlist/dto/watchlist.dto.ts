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
