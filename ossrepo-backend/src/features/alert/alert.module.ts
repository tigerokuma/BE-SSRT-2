import { Module } from '@nestjs/common';
import { EmailController } from './controllers/email.controller';
import { SlackController } from './controllers/slack.controller';
import { JiraController } from './controllers/jira.controller';
import { EmailService } from './services/email.service';
import { SlackService } from './services/slack.service';
import { JiraService } from './services/jira.service';
import { ConfigModule } from '@nestjs/config';
import { SlackRepository } from './repositories/slack.repository';
import { JiraRepository } from './repositories/jira.repository';
import { EmailRepository } from './repositories/email.repository';
import { UserModule } from '../user/user.module';
import { ScheduleModule } from '@nestjs/schedule';


@Module({
  imports: [
    ConfigModule,
    UserModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [
    EmailController,
    SlackController,
    JiraController
  ],
  providers: [
    EmailService,
    SlackService,
    JiraService,
    SlackRepository,
    JiraRepository,
    EmailRepository
  ],
})
export class AlertModule {}