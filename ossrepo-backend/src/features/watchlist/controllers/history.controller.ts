import { Controller, Get } from '@nestjs/common';
import { HistoryService } from '../services/history.service';

@Controller('history')
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  @Get('recent-packages')
  async getRecentPackages() {
    // TODO: Implement recently viewed packages retrieval
    return this.historyService.getRecentPackages();
  }
} 