import { Module } from '@nestjs/common';
import { ActivityController } from './controllers/activity.controller';
import { ActivityService } from './services/activity.service';
import { PrismaModule } from '../../common/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ActivityController],
  providers: [ActivityService],
  exports: [ActivityService],
})
export class ActivityModule {} 