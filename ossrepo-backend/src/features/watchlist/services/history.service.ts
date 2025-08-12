import { Injectable } from '@nestjs/common';
import { HistoryRepository } from '../repositories/history.repository';

@Injectable()
export class HistoryService {
  constructor(private readonly historyRepository: HistoryRepository) {}

  async getRecentPackages() {
    // TODO: Implement recent packages logic
    // - Get user's recent package views/searches
    // - Return recent packages with timestamps
    return this.historyRepository.getRecentPackages();
  }

  async recordPackageView(packageName: string) {
    // TODO: Implement package view recording
    // - Record when user views a package
    // - Maintain history for recent packages feature
    return this.historyRepository.recordPackageView(packageName);
  }
}
