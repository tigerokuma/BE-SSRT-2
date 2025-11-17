import {Injectable} from '@nestjs/common';
import {GraphRepository} from '../repositories/graph.repository';
import {GraphExportDto} from '../dto/graph-export.dto';
import {BuildTaskDto, TriggerBuildDto} from '../dto/build-task.dto';
import {GraphBuilderService} from './graph-builder.service';
import {mapPrismaBuildTaskToDto, mapTaskToDto} from '../utils/graph.mapper';
import * as path from 'path';
import {InjectQueue} from '@nestjs/bull';
import {Queue} from 'bull';

@Injectable()
export class GraphService {
    constructor(
        private readonly repo: GraphRepository,
        private readonly graphBuilder: GraphBuilderService,
        @InjectQueue('graph-build')
        private readonly graphBuildQueue: Queue,
    ) {
    }

    async triggerBuild(
        repoId: string,
        dto: TriggerBuildDto,
    ): Promise<BuildTaskDto> {
        console.log('[GraphService] triggerBuild called with:', {repoId, dto});

        const buildTask = await this.repo.createBuildTask(repoId, dto.commitId);
        console.log('[GraphService] created buildTask:', buildTask.task_id);

        const startedTask = await this.repo.startBuildTask(buildTask.task_id);
        console.log('[GraphService] started buildTask:', startedTask.task_id);

        await this.repo.appendLog(
            buildTask.task_id,
            'Build queued for Python graph builder.',
        );

        const baseDir = process.cwd();
        const safeRepoId = repoId.replace(/[\/\\]/g, '_');
        const repoPath = path.join(baseDir, 'tmp-cloned-repo', safeRepoId);

        console.log('[GraphService] adding Bull job to graph-build queue', {
            repoId,
            repoPath,
            taskId: buildTask.task_id,
            branch: dto.branch ?? 'main',
            startSha: dto.startSha ?? null,
        });

        await this.graphBuildQueue.add('build-repo-graph', {
            repoId,
            repoPath,
            taskId: buildTask.task_id,
            branch: dto.branch ?? 'main',
            startSha: dto.startSha ?? null,
        });

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
        message?: string,
    ): Promise<BuildTaskDto> {
        const updatedTask = await this.repo.updateBuildTaskStatus(taskId, status);
        if (message) {
            await this.repo.appendLog(taskId, message);
        }
        return mapTaskToDto(updatedTask);
    }

    async getExport(
        repoId: string,
        format: string = 'graphml',
    ): Promise<GraphExportDto | null> {
        const exportRow = await this.repo.getLatestExportByRepoId(repoId, format);
        if (!exportRow) return null;
        if (!exportRow.s3_url)
            throw new Error('No export available for this repo/format');
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
