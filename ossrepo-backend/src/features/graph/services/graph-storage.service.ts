import {Injectable} from '@nestjs/common';
import {GraphRepository} from '../repositories/graph.repository';
import {
    SaveNodeDto,
    BatchSaveNodesDto,
    UpdateNodeDto,
    DeleteNodeDto,
    DeleteNodesBySnapshotDto,
} from '../dto/graph-node.dto';
import {
    SaveEdgeDto,
    BatchSaveEdgesDto,
    UpdateEdgeDto,
    DeleteEdgeDto,
    DeleteEdgesBySnapshotDto,
} from '../dto/graph-edge.dto';
import {CreateGraphSnapshotDto, UpdateGraphSnapshotDto} from '../dto/graph-snapshot.dto';

@Injectable()
export class GraphStorageService {
    constructor(private readonly repo: GraphRepository) {
    }

    // --- NODE methods ---
    createNode(snapshotId: string, dto: SaveNodeDto) {
        return this.repo.createNode(snapshotId, dto);
    }

    createNodes(batch: BatchSaveNodesDto) {
        return this.repo.createNodes(batch);
    }

    getNode(nodeId: string) {
        return this.repo.getNode(nodeId);
    }

    getNodesBySnapshot(snapshotId: string) {
        return this.repo.getNodesBySnapshot(snapshotId);
    }

    updateNode(dto: UpdateNodeDto) {
        return this.repo.updateNode(dto);
    }

    deleteNode(dto: DeleteNodeDto) {
        return this.repo.deleteNode(dto.node_id);
    }

    deleteNodesBySnapshot(dto: DeleteNodesBySnapshotDto) {
        return this.repo.deleteNodesBySnapshot(dto);
    }

    // --- EDGE methods ---
    createEdge(snapshotId: string, dto: SaveEdgeDto) {
        return this.repo.createEdge(snapshotId, dto);
    }

    createEdges(batch: BatchSaveEdgesDto) {
        return this.repo.createEdges(batch);
    }

    getEdge(edgeId: string) {
        return this.repo.getEdge(edgeId);
    }

    getEdgesBySnapshot(snapshotId: string) {
        return this.repo.getEdgesBySnapshot(snapshotId);
    }

    updateEdge(dto: UpdateEdgeDto) {
        return this.repo.updateEdge(dto);
    }

    deleteEdge(dto: DeleteEdgeDto) {
        return this.repo.deleteEdge(dto.edge_id);
    }

    deleteEdgesBySnapshot(dto: DeleteEdgesBySnapshotDto) {
        return this.repo.deleteEdgesBySnapshot(dto);
    }

    createGraphSnapshot(dto: CreateGraphSnapshotDto) {
        return this.repo.createGraphSnapshot(dto);
    }

    getGraphSnapshotById(snapshotId: string) {
        return this.repo.getGraphSnapshotById(snapshotId);
    }

    getSnapshotsBySubtask(subtaskId: string) {
        return this.repo.getSnapshotsBySubtask(subtaskId);
    }

    getSnapshotsByRepo(repoId: string) {
        return this.repo.getSnapshotsByRepo(repoId);
    }

    updateGraphSnapshot(dto: UpdateGraphSnapshotDto) {
        return this.repo.updateGraphSnapshot(dto);
    }

    deleteGraphSnapshot(snapshotId: string) {
        return this.repo.deleteGraphSnapshot(snapshotId);
    }

    getSnapshotsByIds(ids: string[]) {
        return this.repo.getSnapshotsByIds(ids);
    }
}
