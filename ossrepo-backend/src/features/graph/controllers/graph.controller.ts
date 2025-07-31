import {
    Controller, Post, Get, Param, Body, Query, HttpCode, Patch, Put, Delete, NotFoundException,
} from '@nestjs/common';

import {GraphService} from '../services/graph.service';
import {GraphStorageService} from '../services/graph-storage.service';
import {GraphBuilderService} from "../services/graph-builder.service";

import {BuildTaskDto, TriggerBuildDto} from '../dto/build-task.dto';
import {BuildSubtaskDto, CreateBuildSubtaskDto, UpdateBuildSubtaskDto} from '../dto/build-subtask.dto';
import {CreateGraphSnapshotDto, GraphSnapshotDto, UpdateGraphSnapshotDto} from '../dto/graph-snapshot.dto';
import {
    BatchCreateGraphNodeDto,
    CreateGraphNodeDto,
    GraphNodeDto,
    UpdateGraphNodeDto,
} from '../dto/graph-node.dto';
import {
    BatchCreateGraphEdgeDto,
    CreateGraphEdgeDto,
    GraphEdgeDto,
    UpdateGraphEdgeDto,
} from '../dto/graph-edge.dto';
import {
    CreateGraphExportDto,
    UpdateGraphExportDto,
    GraphExportDto,
} from '../dto/graph-export.dto';

// ---- CONTROLLER ----
@Controller('graph')
export class GraphController {
    constructor(
        private readonly graphService: GraphService,
        private readonly graphBuilder: GraphBuilderService,
        private readonly graphStorage: GraphStorageService,
    ) {
    }

    // --------- BUILD (PYTHON TRIGGER) -------------
    @Post('build/:repoId')
    @HttpCode(202)
    async triggerBuild(@Param('repoId') repoId: string, @Body() dto: TriggerBuildDto): Promise<BuildTaskDto> {
        return this.graphService.triggerBuild(repoId, dto);
    }

    @Get('status/:repoId')
    async getBuildStatus(@Param('repoId') repoId: string): Promise<BuildTaskDto | null> {
        return this.graphService.getBuildStatus(repoId);
    }

    @Patch('build/:taskId/status')
    async updateBuildTaskStatus(
        @Param('taskId') taskId: string,
        @Body() body: { status: string; message?: string },
    ): Promise<BuildTaskDto> {
        return this.graphService.updateBuildTaskStatus(taskId, body.status, body.message);
    }

    // GET /graph/build
    @Get('build')
    async getBuildTasks(
        @Query('repo_id') repoId?: string, // make repo_id optional
    ): Promise<BuildTaskDto[]> {
        if (repoId) {
            // If repo_id is provided, filter by repo_id
            return this.graphService.getBuildTasksByRepoId(repoId);
        } else {
            // Otherwise, return all build tasks
            return this.graphService.getAllBuildTasks();
        }
    }

    // --------- SUBTASKS (BUILDER) -----------------
    @Post('subtasks')
    async createSubtask(@Body() dto: CreateBuildSubtaskDto): Promise<BuildSubtaskDto> {
        return this.graphBuilder.createSubtask(dto);
    }

    @Get('subtasks/:subtaskId')
    async getSubtask(@Param('subtaskId') subtaskId: string): Promise<BuildSubtaskDto | null> {
        return this.graphBuilder.getSubtask(subtaskId);
    }

    @Patch('subtasks/:subtaskId')
    async updateSubtask(@Param('subtaskId') subtaskId: string, @Body() dto: UpdateBuildSubtaskDto): Promise<BuildSubtaskDto> {
        return this.graphBuilder.updateSubtask(subtaskId, dto);
    }

    @Delete('subtasks/:subtaskId')
    async deleteSubtask(@Param('subtaskId') subtaskId: string) {
        await this.graphBuilder.deleteSubtask(subtaskId);
        return {success: true};
    }

    @Get('subtasks/by-task/:taskId')
    async getSubtasksByTask(@Param('taskId') taskId: string): Promise<BuildSubtaskDto[]> {
        return this.graphBuilder.getSubtasksByTask(taskId);
    }

    // --------- SNAPSHOTS --------------------------
    @Post('snapshots')
    async createSnapshot(@Body() dto: CreateGraphSnapshotDto): Promise<GraphSnapshotDto> {
        return this.graphStorage.createGraphSnapshot(dto);
    }

    @Get('snapshots/:snapshotId')
    async getSnapshot(@Param('snapshotId') snapshotId: string): Promise<GraphSnapshotDto | null> {
        return this.graphStorage.getGraphSnapshotById(snapshotId);
    }

    @Patch('snapshots/:snapshotId')
    async updateSnapshot(@Param('snapshotId') snapshotId: string, @Body() dto: UpdateGraphSnapshotDto): Promise<GraphSnapshotDto> {
        return this.graphStorage.updateGraphSnapshot({...dto, snapshot_id: snapshotId});
    }

    @Delete('snapshots/:snapshotId')
    async deleteSnapshot(@Param('snapshotId') snapshotId: string) {
        await this.graphStorage.deleteGraphSnapshot(snapshotId);
        return {success: true};
    }

    @Get('snapshots/by-subtask/:subtaskId')
    async getSnapshotsBySubtask(@Param('subtaskId') subtaskId: string): Promise<GraphSnapshotDto[]> {
        return this.graphStorage.getSnapshotsBySubtask(subtaskId);
    }

    @Get('snapshots/by-repo/:repoId')
    async getSnapshotsByRepo(@Param('repoId') repoId: string): Promise<GraphSnapshotDto[]> {
        return this.graphStorage.getSnapshotsByRepo(repoId);
    }

    // --------- NODES ------------------------------
    @Post('nodes/batch')
    async batchCreateNodes(@Body() batch: BatchCreateGraphNodeDto): Promise<{ count: number }> {
        return this.graphStorage.createNodes(batch);
    }

    @Post('nodes/:snapshotId')
    async createNode(@Param('snapshotId') snapshotId: string, @Body() dto: CreateGraphNodeDto): Promise<GraphNodeDto> {
        return this.graphStorage.createNode(snapshotId, dto);
    }

    @Get('nodes/:snapshotId')
    async getNodesBySnapshot(@Param('snapshotId') snapshotId: string): Promise<GraphNodeDto[]> {
        return this.graphStorage.getNodesBySnapshot(snapshotId);
    }

    @Put('nodes/:nodeId')
    async updateNode(@Param('nodeId') node_id: string, @Body() dto: UpdateGraphNodeDto): Promise<GraphNodeDto> {
        return this.graphStorage.updateNode({...dto, node_id});
    }

    @Delete('nodes/:nodeId')
    async deleteNode(@Param('nodeId') node_id: string) {
        await this.graphStorage.deleteNode({node_id});
        return {success: true};
    }

    @Delete('nodes/by-snapshot/:snapshotId')
    async deleteNodesBySnapshot(@Param('snapshotId') snapshot_id: string) {
        await this.graphStorage.deleteNodesBySnapshot({snapshot_id});
        return {success: true};
    }

    // --------- EDGES ------------------------------
    @Post('edges/batch')
    async batchCreateEdges(@Body() batch: BatchCreateGraphEdgeDto): Promise<{ count: number }> {
        return this.graphStorage.createEdges(batch);
    }

    @Post('edges/:snapshotId')
    async createEdge(@Param('snapshotId') snapshotId: string, @Body() dto: CreateGraphEdgeDto): Promise<GraphEdgeDto> {
        return this.graphStorage.createEdge(snapshotId, dto);
    }

    @Get('edges/:snapshotId')
    async getEdgesBySnapshot(@Param('snapshotId') snapshotId: string): Promise<GraphEdgeDto[]> {
        return this.graphStorage.getEdgesBySnapshot(snapshotId);
    }

    @Put('edges/:edgeId')
    async updateEdge(@Param('edgeId') edge_id: string, @Body() dto: UpdateGraphEdgeDto): Promise<GraphEdgeDto> {
        return this.graphStorage.updateEdge({...dto, edge_id});
    }

    @Delete('edges/:edgeId')
    async deleteEdge(@Param('edgeId') edge_id: string) {
        await this.graphStorage.deleteEdge({edge_id});
        return {success: true};
    }

    @Delete('edges/by-snapshot/:snapshotId')
    async deleteEdgesBySnapshot(@Param('snapshotId') snapshot_id: string) {
        await this.graphStorage.deleteEdgesBySnapshot({snapshot_id});
        return {success: true};
    }
}
