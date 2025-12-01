import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import IORedis, { RedisOptions } from 'ioredis';
import { ManualProcessorService } from './manual-processor.service';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const redisHost = configService.get('REDIS_HOST', 'localhost');
        const redisPort = parseInt(configService.get('REDIS_PORT', '6379'), 10);
        const redisPassword = configService.get<string>('REDIS_PASSWORD');
        const redisUsername = configService.get<string>('REDIS_USERNAME');

        const redisOptions: RedisOptions = {
          host: redisHost,
          port: redisPort,
          ...(redisPassword && { password: redisPassword }),
          ...(redisUsername && { username: redisUsername }),

          // These two are recommended when using Bull with ioredis
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
        };

        // 🔁 Single shared set of Redis connections for the whole app
        const clients: {
          client?: IORedis;
          subscriber?: IORedis;
          bclient?: IORedis;
        } = {};

        return {
          // Bull will call this for 'client', 'subscriber', 'bclient'
          createClient: (type: 'client' | 'subscriber' | 'bclient') => {
            const makeClient = () => {
              const redis = new IORedis(redisOptions);
              // 🔇 allow more listeners to avoid MaxListenersExceededWarning
              redis.setMaxListeners(50); // or 0 for unlimited
              return redis;
            };

            switch (type) {
              case 'client':
                if (!clients.client) {
                  clients.client = makeClient();
                }
                return clients.client;

              case 'subscriber':
                if (!clients.subscriber) {
                  clients.subscriber = makeClient();
                }
                return clients.subscriber;

              case 'bclient':
                if (!clients.bclient) {
                  clients.bclient = makeClient();
                }
                return clients.bclient;

              default:
                return makeClient();
            }
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
        };
      },
      inject: [ConfigService],
    }),

    BullModule.registerQueue(
      { name: 'repository-setup' },
      { name: 'polling' },
      { name: 'vulnerability-check' },
      { name: 'health-check' },
      { name: 'project-setup' },
      { name: 'dependency-fast-setup' },
      { name: 'dependency-full-setup' },
      { name: 'scorecard-priority' },
      { name: 'scorecard-background' },
      { name: 'package-polling' },
      { name: 'graph-build' },
      { name: 'sbom' },
    ),
  ],
  providers: [ManualProcessorService],
  exports: [BullModule],
})
export class QueueModule {}
