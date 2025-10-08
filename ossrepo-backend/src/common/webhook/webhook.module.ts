import { Module } from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { PrismaModule } from '../prisma/prisma.module';
import { GitHubModule } from '../github/github.module';

@Module({
  imports: [PrismaModule, GitHubModule],
  providers: [WebhookService],
  exports: [WebhookService],
})
export class WebhookModule {}
