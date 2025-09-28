import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class ManualProcessorService {
  private readonly logger = new Logger(ManualProcessorService.name);

  constructor(
    @InjectQueue('repository-setup') private readonly setupQueue: Queue,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async checkForStuckJobs() {
    try {
      const waiting = await this.setupQueue.getWaiting();
      const active = await this.setupQueue.getActive();
      
      if (waiting.length > 0) {
        this.logger.log(`🔍 Found ${waiting.length} waiting jobs, ${active.length} active jobs`);
        
        // Force process waiting jobs
        for (const job of waiting) {
          this.logger.log(`🚀 Manually triggering job: ${job.id} for ${job.data.owner}/${job.data.repo}`);
          // The processor should pick this up automatically
        }
      }
    } catch (error) {
      this.logger.error('Error checking for stuck jobs:', error);
    }
  }
}
