import { Injectable } from '@nestjs/common';

@Injectable()
export class HistoryRepository {
  async getRecentPackages() {
    // TODO: Implement data access for recent packages
    // - Query database for user's recent package views
    // - Order by timestamp (most recent first)
    // - Limit results (e.g., last 20 packages)
    // - Return raw history data
    throw new Error('Not implemented');
  }

  async recordPackageView(packageName: string) {
    // TODO: Implement data access for recording package views
    // - Insert or update package view record
    // - Include timestamp and user context
    // - Cleanup old history entries if needed
    throw new Error('Not implemented');
  }

  async clearHistory() {
    // TODO: Implement data access for clearing user history
    // - Remove all history entries for user
    // - Return success status
    throw new Error('Not implemented');
  }
}

// import { Injectable } from '@nestjs/common';

// @Injectable()
// export class HistoryRepository {
//   getRecentPackages() {
//     return [
//       { name: 'lodash', lastViewed: '2025-06-26T14:00:00Z' },
//       { name: 'axios', lastViewed: '2025-06-25T12:30:00Z' },
//     ];
//   }

//   recordPackageView(packageName: string) {
//     // Just log for now
//     console.log(`Recorded view for package: ${packageName}`);
//     return { success: true };
//   }
// }
