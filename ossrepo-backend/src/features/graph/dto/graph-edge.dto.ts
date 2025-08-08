// For creating a single edge (POST /edges/:snapshotId)
export class CreateGraphEdgeDto {
  source_id: string;
  target_id: string;
  relation: string;
  metadata?: any;
}

// For updating an edge (PUT /edges/:edgeId)
export class UpdateGraphEdgeDto {
  edge_id: string;
  data: Partial<CreateGraphEdgeDto>;
}

// For deleting an edge (DELETE /edges/:edgeId)
export class DeleteGraphEdgeDto {
  edge_id: string;
}

// For deleting edges by snapshot (DELETE /edges/by-snapshot/:snapshotId)
export class DeleteEdgesBySnapshotDto {
  snapshot_id: string;
}

// For batch saving edges (POST /edges/batch)
export class BatchCreateGraphEdgeDto {
  snapshot_id: string;
  edges: CreateGraphEdgeDto[];
}

// Full edge as returned from database (for GETs)
export class GraphEdgeDto {
  edge_id: string;
  snapshot_id: string;
  source_id: string;
  target_id: string;
  relation: string;
  metadata?: any;
}
