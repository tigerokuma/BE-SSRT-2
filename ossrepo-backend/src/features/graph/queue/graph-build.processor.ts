// src/features/graph/processors/graph-build.processor.ts
import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { GraphBuilderService } from '../services/graph-builder.service';
import { GraphRepository } from '../repositories/graph.repository';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { GraphService } from '../services/graph.service';

type GraphBuildJobPayload = {
  repoId: string;
  repoPath: string;
  taskId: string;
  branch?: string;
  startSha?: string | null;
};

@Processor('graph-build')
export class GraphBuildProcessor {
  constructor(
    private readonly graphBuilder: GraphBuilderService,
    private readonly repo: GraphRepository,
    private readonly prisma: PrismaService,   // 👈 NEW
    private readonly graphService: GraphService, // 👈 NEW
  ) {}

   @Process('build-repo-graph')
  async handleBuild(job: Job<GraphBuildJobPayload>) {
    console.log('[GraphBuildProcessor] received job:', job.id, job.data);

    const { repoId, repoPath, taskId, branch, startSha } = job.data;

    await this.repo.appendLog(
      taskId,
      `Dispatching graph build to Python builder (repo=${repoId}, branch=${
        branch ?? 'main'
      })`,
    );

    try {
      const res = await this.graphBuilder.triggerBuild({
        repoId,
        repoPath,
        taskId,
        branch,
        startSha,
      });

      console.log(
        '[GraphBuildProcessor] Python builder response:',
        res.status,
        res.message,
      );

      await this.repo.appendLog(
        taskId,
        `Python builder accepted: status=${res.status}, message=${res.message}`,
      );
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      console.error(
        '[GraphBuildProcessor] Error contacting Python builder:',
        msg,
      );
      await this.repo.appendLog(
        taskId,
        `Error contacting Python builder: ${msg}`,
      );
      await this.repo.updateBuildTaskStatus(taskId, 'failed');
      throw err;
    }
  }


  // 👇 NEW: daily dispatcher job
  @Process('run-daily-graph-build')
  async handleDailyGraphBuild(job: Job) {
    // 1) find all active monitored branches with a repo URL
    const branches = await this.prisma.monitoredBranch.findMany({
      where: {
        is_active: true,
        repository_url: { not: null },
      },
    });

    for (const branch of branches) {
      const repoUrl = branch.repository_url as string;
      const branchName = branch.branch_name || 'main';

      // turn "https://github.com/owner/repo.git" into "owner/repo"
      const match = repoUrl.match(
        /github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?(?:\/.*)?$/,
      );
      if (!match) {
        await this.repo.appendLog(
          '', // no task yet
          `Skipping branch ${branch.id}: unsupported repo URL ${repoUrl}`,
        );
        continue;
      }

      const [, owner, repo] = match;
      const repoId = `${owner}/${repo}`;

      // 2) trigger a build for this repo/branch
      await this.graphService.triggerBuild(repoId, {
        branch: branchName,
        startSha: null, // or last known sha if you track it
        commitId: undefined,
      });
    }
  }
}
