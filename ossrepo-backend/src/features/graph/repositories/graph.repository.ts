import {Injectable} from '@nestjs/common';
import {PrismaService} from "../../../common/prisma/prisma.service";
import {
    BatchCreateGraphNodeDto,
    DeleteNodesBySnapshotDto,
    CreateGraphNodeDto,
    UpdateGraphNodeDto
} from '../dto/graph-node.dto';
import {
    BatchCreateGraphEdgeDto,
    DeleteEdgesBySnapshotDto,
    CreateGraphEdgeDto,
    UpdateGraphEdgeDto
} from '../dto/graph-edge.dto';
import {CreateGraphSnapshotDto, UpdateGraphSnapshotDto} from '../dto/graph-snapshot.dto';
import {mapPrismaSubtaskToDto} from '../utils/graph.mapper';
import {Logger} from '@nestjs/common';
import {BuildSubtaskDto, CreateBuildSubtaskDto, UpdateBuildSubtaskDto} from "../dto/build-subtask.dto";


@Injectable()
export class GraphRepository {
    private readonly logger = new Logger(GraphRepository.name);

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

    async updateBuildTaskStatus(taskId: string, status: string) {
        return this.prisma.buildTask.update({
            where: {task_id: taskId},
            data: {
                status,
                // optionally set finished_at if status is completed/failed
                finished_at: ['completed', 'failed'].includes(status) ? new Date() : undefined
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

    async findAllBuildTasks() {
        return this.prisma.buildTask.findMany();
    }

    async findBuildTasksByRepoId(repoId: string) {
        return this.prisma.buildTask.findMany({where: {repo_id: repoId}});
    }

    async findBuildTaskById(taskId: string) {
        return this.prisma.buildTask.findUnique({where: {task_id: taskId}});
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

    // --- Node CRUD ---
    async createNode(snapshotId: string, dto: CreateGraphNodeDto) {
        this.logger.log(`BatchSaveNodesDto: ${JSON.stringify(dto, null, 2)}`);
        return this.prisma.graphNode.create({
            data: {
                snapshot_id: snapshotId,
                type: dto.type,
                name: dto.name,
                file_path: dto.file_path,
                commit_id: dto.commit_id,
                metadata: dto.metadata,
            },
        });
    }

    async createNodes(batch: BatchCreateGraphNodeDto) {
        this.logger.log(`BatchSaveNodesDto: ${JSON.stringify(batch, null, 2)}`);
        return this.prisma.graphNode.createMany({
            data: batch.nodes.map(n => ({
                snapshot_id: batch.snapshot_id,
                type: n.type,
                name: n.name,
                file_path: n.file_path,
                commit_id: n.commit_id,
                metadata: n.metadata,
            })),
        });
    }

    async getNode(nodeId: string) {
        return this.prisma.graphNode.findUnique({where: {node_id: nodeId}});
    }

    async getNodesBySnapshot(snapshotId: string) {
        return this.prisma.graphNode.findMany({where: {snapshot_id: snapshotId}});
    }

    async updateNode(dto: UpdateGraphNodeDto) {
        return this.prisma.graphNode.update({
            where: {node_id: dto.node_id},
            data: dto.data,
        });
    }

    async deleteNode(nodeId: string) {
        return this.prisma.graphNode.delete({where: {node_id: nodeId}});
    }

    async deleteNodesBySnapshot(dto: DeleteNodesBySnapshotDto) {
        return this.prisma.graphNode.deleteMany({where: {snapshot_id: dto.snapshot_id}});
    }

    // --- Edge CRUD ---
    async createEdge(snapshotId: string, dto: CreateGraphEdgeDto) {
        return this.prisma.graphEdge.create({
            data: {
                snapshot_id: snapshotId,
                source_id: dto.source_id,
                target_id: dto.target_id,
                relation: dto.relation,
                metadata: dto.metadata,
            },
        });
    }

    async createEdges(batch: BatchCreateGraphEdgeDto) {
        return this.prisma.graphEdge.createMany({
            data: batch.edges.map(e => ({
                snapshot_id: batch.snapshot_id,
                source_id: e.source_id,
                target_id: e.target_id,
                relation: e.relation,
                metadata: e.metadata,
            })),
        });
    }

    async getEdge(edgeId: string) {
        return this.prisma.graphEdge.findUnique({where: {edge_id: edgeId}});
    }

    async getEdgesBySnapshot(snapshotId: string) {
        return this.prisma.graphEdge.findMany({where: {snapshot_id: snapshotId}});
    }

    async updateEdge(dto: UpdateGraphEdgeDto) {
        return this.prisma.graphEdge.update({
            where: {edge_id: dto.edge_id},
            data: dto.data,
        });
    }

    async deleteEdge(edgeId: string) {
        return this.prisma.graphEdge.delete({where: {edge_id: edgeId}});
    }

    async deleteEdgesBySnapshot(dto: DeleteEdgesBySnapshotDto) {
        return this.prisma.graphEdge.deleteMany({where: {snapshot_id: dto.snapshot_id}});
    }

    // CREATE
    async createGraphSnapshot(dto: CreateGraphSnapshotDto) {
        return this.prisma.graphSnapshot.create({
            data: {
                subtask_id: dto.subtask_id,
                repo_id: dto.repo_id,
                commit_id: dto.commit_id,
                language: dto.language,
                graph_type: dto.graph_type,
                version: dto.version,
                status: 'stored',
            },
        });
    }

    // READ (by id)
    async getGraphSnapshotById(snapshotId: string) {
        return this.prisma.graphSnapshot.findUnique({
            where: {snapshot_id: snapshotId},
        });
    }

    // READ (by subtask)
    async getSnapshotsBySubtask(subtaskId: string) {
        return this.prisma.graphSnapshot.findMany({
            where: {subtask_id: subtaskId},
        });
    }

    // READ (by repo)
    async getSnapshotsByRepo(repoId: string) {
        return this.prisma.graphSnapshot.findMany({
            where: {repo_id: repoId},
        });
    }

    // UPDATE
    async updateGraphSnapshot(dto: UpdateGraphSnapshotDto) {
        return this.prisma.graphSnapshot.update({
            where: {snapshot_id: dto.snapshot_id},
            data: {
                node_count: dto.node_count,
                edge_count: dto.edge_count,
                s3_url: dto.s3_url,
                status: dto.status,
            },
        });
    }

    // DELETE
    async deleteGraphSnapshot(snapshotId: string) {
        return this.prisma.graphSnapshot.delete({
            where: {snapshot_id: snapshotId},
        });
    }

    // Optional: Batch get by ids
    async getSnapshotsByIds(ids: string[]) {
        return this.prisma.graphSnapshot.findMany({
            where: {snapshot_id: {in: ids}},
        });
    }


    async createGraphSubtask(dto: CreateBuildSubtaskDto): Promise<BuildSubtaskDto> {
        const row = await this.prisma.buildSubtask.create({
            data: {
                task_id: dto.task_id,
                language: dto.language,
                step: dto.step,
                status: dto.status ?? 'pending',
                message: dto.message ?? null,
            },
        });
        return mapPrismaSubtaskToDto(row);
    }

    async getGraphSubtaskById(subtaskId: string): Promise<BuildSubtaskDto | null> {
        const row = await this.prisma.buildSubtask.findUnique({
            where: {subtask_id: subtaskId},
        });
        return row ? mapPrismaSubtaskToDto(row) : null;
    }

    async getGraphSubtasksByTask(taskId: string): Promise<BuildSubtaskDto[]> {
        const rows = await this.prisma.buildSubtask.findMany({
            where: {task_id: taskId},
            orderBy: {created_at: 'asc'},
        });
        return rows.map(mapPrismaSubtaskToDto);
    }

    async updateGraphSubtask(subtaskId: string, dto: UpdateBuildSubtaskDto): Promise<BuildSubtaskDto> {
        const row = await this.prisma.buildSubtask.update({
            where: {subtask_id: subtaskId},
            data: {
                status: dto.status,
                message: dto.message,
                step: dto.step,
                finished_at: dto.status === 'completed' ? new Date() : undefined,
            },
        });
        return mapPrismaSubtaskToDto(row);
    }

    async deleteGraphSubtask(subtaskId: string): Promise<void> {
        await this.prisma.buildSubtask.delete({
            where: {subtask_id: subtaskId},
        });
    }
}
