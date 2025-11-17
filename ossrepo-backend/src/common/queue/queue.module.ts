import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ManualProcessorService } from './manual-processor.service';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const redisHost = configService.get('REDIS_HOST', 'localhost');
        const redisPort = parseInt(configService.get('REDIS_PORT', '6379'));
        const redisPassword = configService.get('REDIS_PASSWORD');
        const redisUsername = configService.get('REDIS_USERNAME');
        
        // Build Redis config object
        const redisConfig: any = {
          host: redisHost,
          port: redisPort,
        };
        
        // Add auth if provided
        if (redisPassword) {
          redisConfig.password = redisPassword;
        }
        if (redisUsername) {
          redisConfig.username = redisUsername;
        }
        
        return {
          redis: redisConfig,
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
      {
        name: 'project-setup',
      },
      {
        name: 'dependency-fast-setup',
      },
      {
        name: 'dependency-full-setup',
      },
      {
        name: 'scorecard-priority',
      },
      {
        name: 'scorecard-background',
      },
      {
        name: 'package-polling',
      },
      {
        name: 'graph-build',
      },
    ),
  ],
  providers: [ManualProcessorService],
  exports: [BullModule],
})
export class QueueModule {}
