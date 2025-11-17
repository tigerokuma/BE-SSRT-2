import { Module } from '@nestjs/common';
import { GitHubService } from './github.service';
import { GitHubAppService } from './github-app.service';

@Module({
  providers: [GitHubService, GitHubAppService],
  exports: [GitHubService, GitHubAppService],
})
export class GitHubModule {}
