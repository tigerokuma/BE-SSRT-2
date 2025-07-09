import {Injectable} from '@nestjs/common';
import {PrismaService} from "../../../common/prisma/prisma.service";

@Injectable()
export class GraphRepository {
    constructor(private readonly prisma: PrismaService) {
    }

    async createBuildTask(
        repoId: string,
        commitId?: string,
        assignedTo?: string,
        retryCount: number = 0
    ) {
        return this.prisma.buildTask.create({
            data: {
                repo_id: repoId,
                status: 'queued',
                logs: [],
                commit_id: commitId ?? null,
                assigned_to: assignedTo ?? null,
                retry_count: retryCount,
            },
        });
    }

    async startBuildTask(taskId: string) {
        return this.prisma.buildTask.update({
            where: {task_id: taskId},
            data: {
                status: 'in_progress',
                started_at: new Date(),
            },
        });
    }

    async finishBuildTask(taskId: string, success: boolean) {
        return this.prisma.buildTask.update({
            where: {task_id: taskId},
            data: {
                status: success ? 'completed' : 'failed',
                finished_at: new Date(),
            },
        });
    }

    async appendLog(taskId: string, log: string) {
        const task = await this.prisma.buildTask.findUnique({
            where: {task_id: taskId},
        });
        const newLogs = [...(task?.logs || []), log];
        return this.prisma.buildTask.update({
            where: {task_id: taskId},
            data: {logs: newLogs},
        });
    }

    async getBuildTaskById(taskId: string) {
        return this.prisma.buildTask.findUnique({
            where: {task_id: taskId},
        });
    }

    async getBuildTasksByRepoId(repoId: string) {
        return this.prisma.buildTask.findMany({
            where: {repo_id: repoId},
            orderBy: {created_at: 'desc'},
        });
    }


    async getLatestBuildTaskByRepoId(repoId: string) {
        return this.prisma.buildTask.findFirst({
            where: {repo_id: repoId},
            orderBy: {created_at: 'desc'},
        });
    }

    async getLatestExportByRepoId(repoId: string, format: string = 'graphml') {
        return this.prisma.graphExport.findFirst({
            where: {repo_id: repoId, format, status: 'ready'},
            orderBy: {created_at: 'desc'},
        });
    }

    async deleteBuildTask(taskId: string) {
        return this.prisma.buildTask.delete({
            where: {task_id: taskId},
        });
    }
}
