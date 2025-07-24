// graph-snapshot.dto.ts

export class CreateGraphSnapshotDto {
  subtask_id: string;
  repo_id: string;
  commit_id?: string;
  language: string;
  graph_type: string;
  version: number;
  status?: string;
}

export class UpdateGraphSnapshotDto {
  snapshot_id: string;
  node_count?: number;
  edge_count?: number;
  status?: string;
  s3_url?: string;
}

export class GraphSnapshotDto {
  snapshot_id: string;
  subtask_id: string;
  repo_id: string;
  commit_id?: string;
  language: string;
  graph_type: string;
  version: number;
  created_at: Date;
  node_count?: number;
  edge_count?: number;
  s3_url?: string;
  status: string;
}
