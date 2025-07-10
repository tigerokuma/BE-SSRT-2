// src/features/watchlist/watchlist.module.ts
import { Module } from '@nestjs/common';
import { AlertCentreController } from './controllers/alert-centre.controller';
import { EmailController } from './controllers/email.controller';
import { SlackController } from './controllers/slack.controller';
import { JiraController } from './controllers/jira.controller';
import { AlertCentreService } from './services/alert-centre.service';
import { EmailService } from './services/email.service';
import { SlackService } from './services/slack.service';
import { JiraService } from './services/jira.service';


@Module({
  controllers: [
    AlertCentreController,
    EmailController,
    SlackController,
    JiraController
  ],
  providers: [
    AlertCentreService,
    EmailService,
    SlackService,
    JiraService,
  ],
})
export class AlertModule {}