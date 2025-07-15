import { Body, Controller, Post } from '@nestjs/common';
import { AddToWatchlistDto } from '../dto/add-to-watchlist.dto';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('Activity')
@Controller('activity')
export class ActivityController {
  @Post('user-watchlist-added')
  @ApiOperation({ summary: 'Add a repository to the user watchlist (test endpoint)' })
  @ApiResponse({ status: 201, description: 'Repository added to watchlist (test)' })
  addToWatchlist(@Body() dto: AddToWatchlistDto) {
    console.log('Repo added to watchlist:', dto);
    return { message: 'Repo added to watchlist (test)', data: dto };
  }
} 