import { Injectable } from '@nestjs/common';
import {PrismaService} from "../../../common/prisma/prisma.service";
@Injectable()
export class GraphRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createBuildTask(repoId: string, commitId?: string) {
    // Make sure your Prisma schema supports commitId if you want to store it!
    return this.prisma.buildTask.create({
      data: {
        repo_id: repoId,
        status: 'queued',
        logs: [],
      },
    });
  }
}
