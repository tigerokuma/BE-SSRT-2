import {
    Controller, Post, Get, Param, Body, Query, HttpCode, Patch, Put, Delete,
    NotFoundException,
} from '@nestjs/common';
import {GraphService} from '../services/graph.service';
import {GraphStorageService} from '../services/graph-storage.service';
import {TriggerBuildDto} from '../dto/trigger-build.dto';
import {BuildResponseDto} from '../dto/build-response.dto';
import {BuildStatusDto} from '../dto/build-status.dto';
import {ExportGraphDto} from '../dto/export-graph.dto';

import {
    SaveNodeDto, BatchSaveNodesDto, UpdateNodeDto, DeleteNodeDto, DeleteNodesBySnapshotDto,
} from '../dto/graph-node.dto';
import {
    SaveEdgeDto, BatchSaveEdgesDto, UpdateEdgeDto, DeleteEdgeDto, DeleteEdgesBySnapshotDto,
} from '../dto/graph-edge.dto';
import {CreateGraphSnapshotDto, GraphSnapshotDto, UpdateGraphSnapshotDto} from '../dto/graph-snapshot.dto';
import {mapPrismaSnapshotToDto} from '../utils/graph.mapper';
import {CreateGraphSubtaskDto, GraphSubtaskDto, UpdateGraphSubtaskDto} from '../dto/graph-subtask.dto';
import {GraphBuilderService} from "../services/graph-builder.service";

@Controller('graph')
export class GraphController {
    constructor(
        private readonly graphService: GraphService,
        private readonly graphBuilder: GraphBuilderService,
        private readonly graphStorage: GraphStorageService,
    ) {}

    // --- NODE ENDPOINTS (GraphStorageService) ---

    // 1. STATIC ROUTES FIRST
    @Post('nodes/batch')
    async batchCreateNodes(@Body() batch: BatchSaveNodesDto) {
        return this.graphStorage.createNodes(batch);
    }

    @Delete('nodes/by-snapshot/:snapshotId')
    async deleteNodesBySnapshot(@Param('snapshotId') snapshot_id: string) {
        return this.graphStorage.deleteNodesBySnapshot({snapshot_id});
    }

    // 2. PARAMETERIZED ROUTES AFTER
    @Post('nodes/:snapshotId')
    async createNode(@Param('snapshotId') snapshotId: string, @Body() dto: SaveNodeDto) {
        return this.graphStorage.createNode(snapshotId, dto);
    }

    @Get('nodes/:snapshotId')
    async getNodesBySnapshot(@Param('snapshotId') snapshotId: string) {
        return this.graphStorage.getNodesBySnapshot(snapshotId);
    }

    @Put('nodes/:nodeId')
    async updateNode(@Param('nodeId') node_id: string, @Body() dto: UpdateNodeDto) {
        return this.graphStorage.updateNode({...dto, node_id});
    }

    @Delete('nodes/:nodeId')
    async deleteNode(@Param('nodeId') node_id: string) {
        return this.graphStorage.deleteNode({node_id});
    }

    // --- EDGE ENDPOINTS (GraphStorageService) ---

    @Post('edges/batch')
    async batchCreateEdges(@Body() batch: BatchSaveEdgesDto) {
        return this.graphStorage.createEdges(batch);
    }

    @Delete('edges/by-snapshot/:snapshotId')
    async deleteEdgesBySnapshot(@Param('snapshotId') snapshot_id: string) {
        return this.graphStorage.deleteEdgesBySnapshot({snapshot_id});
    }

    @Post('edges/:snapshotId')
    async createEdge(@Param('snapshotId') snapshotId: string, @Body() dto: SaveEdgeDto) {
        return this.graphStorage.createEdge(snapshotId, dto);
    }

    @Get('edges/:snapshotId')
    async getEdgesBySnapshot(@Param('snapshotId') snapshotId: string) {
        return this.graphStorage.getEdgesBySnapshot(snapshotId);
    }

    @Put('edges/:edgeId')
    async updateEdge(@Param('edgeId') edge_id: string, @Body() dto: UpdateEdgeDto) {
        return this.graphStorage.updateEdge({...dto, edge_id});
    }

    @Delete('edges/:edgeId')
    async deleteEdge(@Param('edgeId') edge_id: string) {
        return this.graphStorage.deleteEdge({edge_id});
    }

    // --- SNAPSHOT ENDPOINTS ---
    @Post('snapshots')
    async createSnapshot(@Body() dto: CreateGraphSnapshotDto): Promise<GraphSnapshotDto> {
        const prismaResult = await this.graphStorage.createGraphSnapshot(dto);
        return mapPrismaSnapshotToDto(prismaResult);
    }
    @Get('snapshots/:snapshotId')
    async getSnapshot(@Param('snapshotId') snapshotId: string) {
        return this.graphStorage.getGraphSnapshotById(snapshotId);
    }
    @Get('snapshots/by-subtask/:subtaskId')
    async getSnapshotsBySubtask(@Param('subtaskId') subtaskId: string) {
        return this.graphStorage.getSnapshotsBySubtask(subtaskId);
    }
    @Get('snapshots/by-repo/:repoId')
    async getSnapshotsByRepo(@Param('repoId') repoId: string) {
        return this.graphStorage.getSnapshotsByRepo(repoId);
    }
    @Patch('snapshots/:snapshotId')
    async updateSnapshot(@Param('snapshotId') snapshotId: string, @Body() dto: UpdateGraphSnapshotDto) {
        return this.graphStorage.updateGraphSnapshot({...dto, snapshotId});
    }
    @Delete('snapshots/:snapshotId')
    async deleteSnapshot(@Param('snapshotId') snapshotId: string) {
        return this.graphStorage.deleteGraphSnapshot(snapshotId);
    }

    // --- SUBTASK ENDPOINTS ---
    @Post('subtasks')
    async createSubtask(@Body() dto: CreateGraphSubtaskDto): Promise<GraphSubtaskDto> {
        return this.graphBuilder.createSubtask(dto);
    }
    @Get('subtasks/by-task/:taskId')
    async getSubtasksByTask(@Param('taskId') taskId: string) {
        return this.graphBuilder.getSubtasksByTask(taskId);
    }
    @Get('subtasks/:subtaskId')
    async getSubtask(@Param('subtaskId') subtaskId: string) {
        const result = await this.graphBuilder.getSubtask(subtaskId);
        if (!result) throw new NotFoundException(`Subtask ${subtaskId} not found`);
        return result;
    }
    @Patch('subtasks/:subtaskId')
    async updateSubtask(@Param('subtaskId') subtaskId: string, @Body() dto: UpdateGraphSubtaskDto) {
        return this.graphBuilder.updateSubtask(subtaskId, dto);
    }
    @Delete('subtasks/:subtaskId')
    async deleteSubtask(@Param('subtaskId') subtaskId: string) {
        return this.graphBuilder.deleteSubtask(subtaskId);
    }

    // --- BUILD/STATUS/EXPORT ENDPOINTS ---
    @Post('build/:repoId')
    @HttpCode(202)
    async triggerBuild(@Param('repoId') repoId: string, @Body() dto: TriggerBuildDto): Promise<BuildResponseDto> {
        return this.graphService.triggerBuild(repoId, dto);
    }
    @Get('status/:repoId')
    async getBuildStatus(@Param('repoId') repoId: string): Promise<BuildStatusDto | null> {
        return this.graphService.getBuildStatus(repoId);
    }
    @Patch('build/:taskId/status')
    async updateBuildTaskStatus(
        @Param('taskId') taskId: string,
        @Body() body: { status: string, message?: string },
    ) {
        const updated = await this.graphService.updateBuildTaskStatus(taskId, body.status, body.message);
        return {success: !!updated};
    }
    @Get('export/:repoId')
    async getExport(@Param('repoId') repoId: string, @Query('format') format?: string): Promise<ExportGraphDto | null> {
        return this.graphService.getExport(repoId, format || 'graphml');
    }
}
