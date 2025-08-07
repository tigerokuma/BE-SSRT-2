import {Injectable} from '@nestjs/common';
import {GraphRepository} from '../repositories/graph.repository';
import {
    CreateGraphNodeDto,
    BatchCreateGraphNodeDto,
    UpdateGraphNodeDto,
    DeleteGraphNodeDto,
    DeleteNodesBySnapshotDto,
    GraphNodeDto,
} from '../dto/graph-node.dto';
import {
    CreateGraphEdgeDto,
    BatchCreateGraphEdgeDto,
    UpdateGraphEdgeDto,
    DeleteGraphEdgeDto,
    DeleteEdgesBySnapshotDto,
} from '../dto/graph-edge.dto';
import {CreateGraphSnapshotDto, GraphSnapshotDto, UpdateGraphSnapshotDto} from '../dto/graph-snapshot.dto';
import {mapPrismaNodeToDto, mapPrismaSnapshotToDto} from '../utils/graph.mapper';

@Injectable()
export class GraphStorageService {
    constructor(private readonly repo: GraphRepository) {
    }

    // --- NODE methods ---
    async createNode(snapshotId: string, dto: CreateGraphNodeDto): Promise<GraphNodeDto> {
        const n = await this.repo.createNode(snapshotId, dto);
        return mapPrismaNodeToDto(n);
    }

    async createNodes(batch: BatchCreateGraphNodeDto): Promise<{ count: number }> {
        // Prisma's createMany returns `{ count: number }`, not entities.
        return this.repo.createNodes(batch);
    }

    async getNode(nodeId: string): Promise<GraphNodeDto | null> {
        const n = await this.repo.getNode(nodeId);
        return n ? mapPrismaNodeToDto(n) : null;
    }

    async getNodesBySnapshot(snapshotId: string): Promise<GraphNodeDto[]> {
        const nodes = await this.repo.getNodesBySnapshot(snapshotId);
        return nodes.map(mapPrismaNodeToDto);
    }

    async updateNode(dto: UpdateGraphNodeDto): Promise<GraphNodeDto> {
        const n = await this.repo.updateNode(dto);
        return mapPrismaNodeToDto(n);
    }

    async deleteNode(dto: DeleteGraphNodeDto): Promise<GraphNodeDto> {
        const n = await this.repo.deleteNode(dto.node_id);
        return mapPrismaNodeToDto(n);
    }

    async deleteNodesBySnapshot(dto: DeleteNodesBySnapshotDto): Promise<{ count: number }> {
        return this.repo.deleteNodesBySnapshot(dto);
    }

    // --- EDGE methods ---
    createEdge(snapshotId: string, dto: CreateGraphEdgeDto) {
        return this.repo.createEdge(snapshotId, dto);
    }

    createEdges(batch: BatchCreateGraphEdgeDto) {
        return this.repo.createEdges(batch);
    }

    getEdge(edgeId: string) {
        return this.repo.getEdge(edgeId);
    }

    getEdgesBySnapshot(snapshotId: string) {
        return this.repo.getEdgesBySnapshot(snapshotId);
    }

    updateEdge(dto: UpdateGraphEdgeDto) {
        return this.repo.updateEdge(dto);
    }

    deleteEdge(dto: DeleteGraphEdgeDto) {
        return this.repo.deleteEdge(dto.edge_id);
    }

    deleteEdgesBySnapshot(dto: DeleteEdgesBySnapshotDto) {
        return this.repo.deleteEdgesBySnapshot(dto);
    }

    // --- SNAPSHOT methods (unchanged) ---
    async createGraphSnapshot(dto: CreateGraphSnapshotDto): Promise<GraphSnapshotDto> {
        const row = await this.repo.createGraphSnapshot(dto);
        return mapPrismaSnapshotToDto(row);
    }

    async getGraphSnapshotById(snapshotId: string): Promise<GraphSnapshotDto | null> {
        const row = await this.repo.getGraphSnapshotById(snapshotId);
        return row ? mapPrismaSnapshotToDto(row) : null;
    }

    async getSnapshotsBySubtask(subtaskId: string): Promise<GraphSnapshotDto[]> {
        const rows = await this.repo.getSnapshotsBySubtask(subtaskId);
        return rows.map(mapPrismaSnapshotToDto);
    }

    async getSnapshotsByRepo(repoId: string): Promise<GraphSnapshotDto[]> {
        const rows = await this.repo.getSnapshotsByRepo(repoId);
        return rows.map(mapPrismaSnapshotToDto);
    }

    async updateGraphSnapshot(dto: UpdateGraphSnapshotDto): Promise<GraphSnapshotDto> {
        const row = await this.repo.updateGraphSnapshot(dto);
        return mapPrismaSnapshotToDto(row);
    }

    async deleteGraphSnapshot(snapshotId: string): Promise<GraphSnapshotDto> {
        // Optionally return deleted snapshot, or void if you don't want to return anything
        const row = await this.repo.deleteGraphSnapshot(snapshotId);
        return mapPrismaSnapshotToDto(row);
    }

    async getSnapshotsByIds(ids: string[]): Promise<GraphSnapshotDto[]> {
        const rows = await this.repo.getSnapshotsByIds(ids);
        return rows.map(mapPrismaSnapshotToDto);
    }

    async queryNodes(filter: any) {
        // Use Prisma or SQL to get nodes by filter
        return this.repo.queryNodes(filter)
    }

    async queryEdges(filter: any) {
        return this.repo.queryEdges(filter)
    }
}

