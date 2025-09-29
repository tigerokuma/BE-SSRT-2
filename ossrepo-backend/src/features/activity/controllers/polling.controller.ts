import {
  Body,
  Controller,
  Post,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ActivityService } from '../services/activity.service';
import { ApiTags, ApiResponse } from '@nestjs/swagger';

@ApiTags('Polling')
@Controller('polling')
export class PollingController {
  private readonly logger = new Logger(PollingController.name);

  constructor(private readonly activityService: ActivityService) {}

  @Post('trigger-daily')
  @ApiResponse({
    status: 201,
    description: 'Daily polling job triggered successfully',
  })
  async triggerDailyPolling(
    @Body()
    body: {
      delay?: number;
    } = {},
  ) {
    this.logger.log(
      `🔄 Triggering daily polling job${body.delay ? ` (delayed by ${body.delay}s)` : ''}`,
    );

    try {
      await this.activityService.triggerPollingJob(
        'daily-poll',
        undefined,
        undefined,
        undefined,
        undefined,
        body.delay || 0,
      );

      return {
        success: true,
        message: 'Daily polling job queued successfully',
        type: 'daily-poll',
        delay: body.delay || 0,
      };
    } catch (error) {
      this.logger.error(`Error triggering daily polling job: ${error.message}`);
      throw new HttpException(
        `Failed to trigger daily polling job: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
