// dto/graph-edge.dto.ts

export class SaveEdgeDto {
  source_id: string;
  target_id: string;
  relation: string;
  metadata?: any;
}

export class UpdateEdgeDto {
  edge_id: string;
  data: Partial<SaveEdgeDto>;
}

export class DeleteEdgeDto {
  edge_id: string;
}

export class DeleteEdgesBySnapshotDto {
  snapshot_id: string;
}

export class BatchSaveEdgesDto {
  snapshot_id: string;
  edges: SaveEdgeDto[];
}
