import {Injectable} from '@nestjs/common';
import {GraphRepository} from '../repositories/graph.repository';
import {GraphExportDto} from '../dto/graph-export.dto';
import {BuildTaskDto, TriggerBuildDto} from '../dto/build-task.dto';
import {GraphBuilderService} from './graph-builder.service';
import {mapPrismaBuildTaskToDto, mapTaskToDto} from '../utils/graph.mapper'
import * as path from 'path';

@Injectable()
export class GraphService {
    constructor(
        private readonly repo: GraphRepository,
        private readonly graphBuilder: GraphBuilderService,
    ) {
    }

    async triggerBuild(repoId: string, dto: TriggerBuildDto): Promise<BuildTaskDto> {
        // 1. Create a build task for the repo
        const buildTask = await this.repo.createBuildTask(repoId, dto.commitId);

        // Immediately mark task as in_progress and set started_at
        const startedTask = await this.repo.startBuildTask(buildTask.task_id);

        // Optional: append log entry
        await this.repo.appendLog(buildTask.task_id, 'Build started and Python builder triggered.');

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

        // Return the full BuildTaskDto (with status "in_progress")
        return {
            ...startedTask,
            started_at: startedTask.started_at ?? undefined,
            finished_at: startedTask.finished_at ?? undefined,
            created_at: startedTask.created_at ?? undefined,
            commit_id: startedTask.commit_id ?? undefined,
            assigned_to: startedTask.assigned_to ?? undefined,
        };
    }

    async getBuildStatus(repoId: string): Promise<BuildTaskDto | null> {
        const task = await this.repo.getLatestBuildTaskByRepoId(repoId);
        if (!task) return null;
        // You may want to do some conversion (see below)
        return {
            ...task,
            started_at: task.started_at ?? undefined,
            finished_at: task.finished_at ?? undefined,
            created_at: task.created_at ?? undefined,
            commit_id: task.commit_id ?? undefined,
            assigned_to: task.assigned_to ?? undefined,
        };
    }

    async updateBuildTaskStatus(
        taskId: string,
        status: string,
        message?: string
    ): Promise<BuildTaskDto> {
        const updatedTask = await this.repo.updateBuildTaskStatus(taskId, status);
        if (message) {
            await this.repo.appendLog(taskId, message);
        }
        return mapTaskToDto(updatedTask);
    }

    async getExport(
        repoId: string,
        format: string = 'graphml'
    ): Promise<GraphExportDto | null> {
        const exportRow = await this.repo.getLatestExportByRepoId(repoId, format);
        if (!exportRow) return null;
        if (!exportRow.s3_url) throw new Error('No export available for this repo/format');
        return {
            export_id: exportRow.export_id,
            repo_id: exportRow.repo_id,
            format: exportRow.format,
            ready_time: exportRow.ready_time ?? undefined,
            s3_url: exportRow.s3_url ?? undefined,
            status: exportRow.status,
            actor: exportRow.actor ?? undefined,
            created_at: exportRow.created_at ?? undefined,
        };
    }

    async getAllBuildTasks(): Promise<BuildTaskDto[]> {
        const rows = await this.repo.findAllBuildTasks();
        return rows.map(mapPrismaBuildTaskToDto);
    }

    async getBuildTasksByRepoId(repoId: string) {
        const rows = await this.repo.findBuildTasksByRepoId(repoId);
        return rows.map(mapPrismaBuildTaskToDto);
    }
}
