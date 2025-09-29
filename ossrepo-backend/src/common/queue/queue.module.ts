import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        redis: {
          host: configService.get('REDIS_HOST', 'localhost'),
          port: parseInt(configService.get('REDIS_PORT', '6379')),
          // Add authentication if provided
          ...(configService.get('REDIS_PASSWORD') && { password: configService.get('REDIS_PASSWORD') }),
          ...(configService.get('REDIS_USERNAME') && { username: configService.get('REDIS_USERNAME') }),
          // Add connection options for cloud Redis
          connectTimeout: 10000,
          lazyConnect: true,
          retryDelayOnFailover: 100,
          // Additional options for cloud Redis
          family: 4, // Force IPv4
          keepAlive: 30000,
          retryDelayOnClusterDown: 300,
          enableReadyCheck: false,
          maxRetriesPerRequest: null,
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
  exports: [BullModule],
})
export class QueueModule {}
