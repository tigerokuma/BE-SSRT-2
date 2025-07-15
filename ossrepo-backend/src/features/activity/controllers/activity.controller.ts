import { Body, Controller, Post } from '@nestjs/common';
import { AddToWatchlistDto } from '../dto/add-to-watchlist.dto';
import { ActivityService } from '../services/activity.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('Activity')
@Controller('activity')
export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  @Post('user-watchlist-added')
  @ApiOperation({ summary: 'Add a repository to the user watchlist with activity monitoring settings' })
  @ApiResponse({ status: 201, description: 'Repository added to watchlist with alert configuration' })
  async addToWatchlist(@Body() dto: AddToWatchlistDto) {
    console.log('=== Repository Added to Watchlist ===');
    console.log('Repository URL:', dto.repo_url);
    console.log('Added by:', dto.added_by);
    console.log('Notes:', dto.notes || 'No notes provided');
    console.log('Alert Settings:');
    console.log('  - Lines Added/Deleted:', dto.alerts.lines_added_deleted.enabled ? 'ENABLED' : 'DISABLED', dto.alerts.lines_added_deleted);
    console.log('  - Files Changed:', dto.alerts.files_changed.enabled ? 'ENABLED' : 'DISABLED', dto.alerts.files_changed);
    console.log('  - High Churn:', dto.alerts.high_churn.enabled ? 'ENABLED' : 'DISABLED', dto.alerts.high_churn);
    console.log('  - Ancestry Breaks:', dto.alerts.ancestry_breaks.enabled ? 'ENABLED' : 'DISABLED', dto.alerts.ancestry_breaks);
    console.log('  - Unusual Author Activity:', dto.alerts.unusual_author_activity.enabled ? 'ENABLED' : 'DISABLED', dto.alerts.unusual_author_activity);
    console.log('=====================================');
    
    // Call the service to handle database operations
    const result = await this.activityService.addToWatchlist(dto);
    
    return result;
  }
} 