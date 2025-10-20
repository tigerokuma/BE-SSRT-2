import { Module } from '@nestjs/common';
import { GitHubService } from './github.service';
import { GitHubController } from './github.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { GitHubService as CommonGitHubService } from '../../common/github/github.service';
import {UserModule} from "../user/user.module";

@Module({
  imports: [PrismaModule, UserModule],
  controllers: [GitHubController],
  providers: [GitHubService, CommonGitHubService],
  exports: [GitHubService],
})
export class GitHubModule {}
