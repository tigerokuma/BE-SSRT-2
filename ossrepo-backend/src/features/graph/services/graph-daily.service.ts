// src/features/graph/services/graph-daily.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

@Injectable()
export class GraphDailyService implements OnModuleInit {
  private readonly logger = new Logger(GraphDailyService.name);

  constructor(
    @InjectQueue('graph-build')
    private readonly graphBuildQueue: Queue,
  ) {}

  async onModuleInit() {
    // This registers a repeatable Bull job. Using jobId ensures
    // we don't create duplicates on each deploy / restart.
    await this.graphBuildQueue.add(
      'run-daily-graph-build',
      {}, // no payload needed, the processor will decide what to build
      {
        jobId: 'run-daily-graph-build',    // dedupe key
        repeat: {
          cron: '0 3 * * *',               // every day at 03:00
        },
      },
    );

    this.logger.log('📆 Registered repeatable job: run-daily-graph-build @ 03:00 daily');
  }
}
