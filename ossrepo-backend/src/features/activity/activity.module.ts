import { Module } from '@nestjs/common';
import { ActivityController } from './controllers/activity.controller';

@Module({
  controllers: [ActivityController],
  exports: [],
})
export class ActivityModule {} 