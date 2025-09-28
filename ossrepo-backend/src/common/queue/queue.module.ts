import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ManualProcessorService } from './manual-processor.service';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        redis: {
          host: configService.get('REDIS_HOST', 'localhost'),
          port: parseInt(configService.get('REDIS_PORT', '6379')),
          // Add authentication if provided
          ...(configService.get('REDIS_PASSWORD') && {
            password: configService.get('REDIS_PASSWORD'),
          }),
          ...(configService.get('REDIS_USERNAME') && {
            username: configService.get('REDIS_USERNAME'),
          }),
          // Single connection for hosted Redis
          maxRetriesPerRequest: 1,
          enableReadyCheck: false,
          lazyConnect: false,
          connectTimeout: 5000,
          commandTimeout: 3000,
          retryDelayOnFailover: 100,
          family: 4,
          keepAlive: 0,
        },
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 50,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue(
      {
        name: 'repository-setup',
      },
      {
        name: 'polling',
      },
      {
        name: 'vulnerability-check',
      },
      {
        name: 'health-check',
      },
    ),
  ],
  providers: [ManualProcessorService],
  exports: [BullModule],
})
export class QueueModule {}
