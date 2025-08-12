import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '../../../generated/prisma';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
      // Add connection pooling configuration
      log: ['error', 'warn'],
    });
  }

  // Connects to database when app starts
  async onModuleInit() {
    await this.$connect();
  }

  // Disconnects from database when app stops
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
