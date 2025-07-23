// dto/graph-node.dto.ts

export class SaveNodeDto {
  type: string;
  name?: string;
  file_path?: string;
  commit_id?: string;
  metadata?: any;
}

export class UpdateNodeDto {
  node_id: string;
  data: Partial<SaveNodeDto>;
}

export class DeleteNodeDto {
  node_id: string;
}

export class DeleteNodesBySnapshotDto {
  snapshot_id: string;
}

export class BatchSaveNodesDto {
  snapshot_id: string;
  nodes: SaveNodeDto[];
}
