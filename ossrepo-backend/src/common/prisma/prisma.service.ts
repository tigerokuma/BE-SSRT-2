import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '../../../generated/prisma';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  // Connects to database when app starts
  async onModuleInit() {
    await this.$connect();
  }
  // Disconnects from database when app stops
  async onModuleDestroy() {
    await this.$disconnect();
  }
}