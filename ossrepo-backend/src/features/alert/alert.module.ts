import { Module } from '@nestjs/common';
import { AlertCentreController } from './controllers/alert-centre.controller';
import { EmailController } from './controllers/email.controller';
import { SlackController } from './controllers/slack.controller';
import { JiraController } from './controllers/jira.controller';
import { AlertCentreService } from './services/alert-centre.service';
import { EmailService } from './services/email.service';
import { SlackService } from './services/slack.service';
import { JiraService } from './services/jira.service';
import { ConfigModule } from '@nestjs/config';
import { SlackRepository } from './repositories/slack.repository';
import { JiraRepository } from './repositories/jira.repository';
import { EmailRepository } from './repositories/email.repository';


@Module({
  imports: [ConfigModule],
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
    SlackRepository,
    JiraRepository,
    EmailRepository
  ],
})
export class AlertModule {}