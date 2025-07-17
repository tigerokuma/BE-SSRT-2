import { Body, Controller, Post, Get, Param, Logger } from '@nestjs/common';
import { AddToWatchlistDto } from '../dto/add-to-watchlist.dto';
import { ActivityService } from '../services/activity.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('Activity')
@Controller('activity')
export class ActivityController {
  private readonly logger = new Logger(ActivityController.name);
  
  constructor(private readonly activityService: ActivityService) {}

  @Post('user-watchlist-added')
  @ApiResponse({ status: 201, description: 'Repository added to watchlist with alert configuration' })
  async addToWatchlist(@Body() dto: AddToWatchlistDto) {
    this.logger.log(`📝 Adding ${dto.repo_url} to watchlist (${dto.added_by})`);
    
    // Call the service to handle database operations
    const result = await this.activityService.addToWatchlist(dto);
    
    return result;
  }

  @Get('watchlist/:watchlistId/status')
  @ApiResponse({ status: 200, description: 'Watchlist status retrieved successfully' })
  async getWatchlistStatus(@Param('watchlistId') watchlistId: string) {
    return await this.activityService.getWatchlistStatus(watchlistId);
  }
} 