// For creating a single node (used for POST /nodes/:snapshotId)
export class CreateGraphNodeDto {
  type: string;
  name?: string;
  file_path?: string;
  commit_id?: string;
  metadata?: any;
}

// For updating a node (PUT /nodes/:nodeId)
export class UpdateGraphNodeDto {
  node_id: string;
  data: Partial<CreateGraphNodeDto>;
}

// For deleting a node (DELETE /nodes/:nodeId)
export class DeleteGraphNodeDto {
  node_id: string;
}

// For deleting nodes by snapshot (DELETE /nodes/by-snapshot/:snapshotId)
export class DeleteNodesBySnapshotDto {
  snapshot_id: string;
}

// For batch saving nodes (POST /nodes/batch)
export class BatchCreateGraphNodeDto {
  snapshot_id: string;
  nodes: CreateGraphNodeDto[];
}

// Full node as returned from database (for GETs)
export class GraphNodeDto {
  node_id: string;
  snapshot_id: string;
  type: string;
  name?: string;
  file_path?: string;
  commit_id?: string;
  metadata?: any;
}
