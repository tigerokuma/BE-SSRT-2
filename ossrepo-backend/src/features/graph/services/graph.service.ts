import {Injectable} from '@nestjs/common';
import {GraphRepository} from '../repositories/graph.repository';
import {TriggerBuildDto} from '../dto/trigger-build.dto';
import {BuildResponseDto} from '../dto/build-response.dto';
import {BuildStatusDto} from '../dto/build-status.dto';
import {ExportGraphDto} from '../dto/export-graph.dto';
import {GraphBuilderService} from './graph-builder.service';
import * as path from 'path';

@Injectable()
export class GraphService {
    constructor(
        private readonly repo: GraphRepository,
        private readonly graphBuilder: GraphBuilderService,
    ) {
    }

    async triggerBuild(repoId: string, dto: TriggerBuildDto): Promise<BuildResponseDto> {
        // 1. Create a build task for the repo (whole repo, no language)
        const buildTask = await this.repo.createBuildTask(repoId, dto.commitId);

        // Immediately mark task as in_progress and set started_at
        await this.repo.startBuildTask(buildTask.task_id);

        // Optional: append log entry
        await this.repo.appendLog(buildTask.task_id, "Build started and Python builder triggered.");

        const baseDir = process.cwd();
        const safeRepoId = repoId.replace(/[\/\\]/g, '_');
        const repoPath = path.join(baseDir, 'tmp-cloned-repo', safeRepoId);

        // Now trigger the Python builder
        this.graphBuilder.triggerBuild({
            repoId,
            repoPath,
            taskId: buildTask.task_id,
            commitId: dto.commitId,
        });

        return {
            message: 'Build triggered',
            repoId,
            status: 'in_progress',
            buildTaskId: buildTask.task_id,
        };
    }


    async getBuildStatus(repoId: string): Promise<BuildStatusDto | null> {
        const task = await this.repo.getLatestBuildTaskByRepoId(repoId);
        if (!task) return null;
        return {
            repoId,
            buildTaskId: task.task_id,
            status: task.status,
            startedAt: task.started_at,
            finishedAt: task.finished_at,
            lastUpdated: task.created_at, // or another timestamp if you prefer
        };
    }

    async updateBuildTaskStatus(taskId: string, status: string, message?: string) {
    const updatedTask = await this.repo.updateBuildTaskStatus(taskId, status);
    if (message) {
        await this.repo.appendLog(taskId, message);
    }
    return updatedTask;
}

    async getExport(repoId: string, format: string = 'graphml'): Promise<ExportGraphDto | null> {
        const exportRow = await this.repo.getLatestExportByRepoId(repoId, format);
        if (!exportRow) return null;
        if (!exportRow.s3_url) throw new Error("No export available for this repo/format");
        return {
            repoId,
            format: exportRow.format,
            downloadUrl: exportRow.s3_url,
        };
    }
}