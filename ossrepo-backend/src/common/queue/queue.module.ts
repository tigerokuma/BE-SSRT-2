import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ManualProcessorService } from './manual-processor.service';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const bullmqMode = configService.get('BULLMQ_MODE', 'local');
        
        // Base configuration for both modes
        const baseConfig = {
          defaultJobOptions: {
            removeOnComplete: 100,
            removeOnFail: 50,
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 2000,
            },
          },
        };

        if (bullmqMode === 'cloud') {
          // Cloud/hosted Redis configuration
          return {
            ...baseConfig,
            redis: {
              host: configService.get('REDIS_HOST'),
              port: parseInt(configService.get('REDIS_PORT', '6379')),
              password: configService.get('REDIS_PASSWORD'),
              username: configService.get('REDIS_USERNAME'),
              // Optimized settings for cloud Redis
              maxRetriesPerRequest: 1,
              enableReadyCheck: false,
              lazyConnect: false,
              connectTimeout: 10000,
              commandTimeout: 5000,
              retryDelayOnFailover: 100,
              family: 4,
              keepAlive: 0
            },
          };
        } else {
          // Local Redis configuration
          return {
            ...baseConfig,
            redis: {
              host: configService.get('REDIS_HOST', 'localhost'),
              port: parseInt(configService.get('REDIS_PORT', '6379')),
              // Local Redis typically doesn't need auth
              ...(configService.get('REDIS_PASSWORD') && {
                password: configService.get('REDIS_PASSWORD'),
              }),
              // Optimized settings for local Redis
              maxRetriesPerRequest: 3,
              enableReadyCheck: true,
              lazyConnect: true,
              connectTimeout: 5000,
              commandTimeout: 3000,
              retryDelayOnFailover: 100,
              family: 4,
              keepAlive: 30000,
            },
          };
        }
      },
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
