export class CreateGraphSnapshotDto {
  subtaskId: string;
  repoId: string;
  commitId?: string;
  language: string;
  graphType: string;
  version: number;
}

export class UpdateGraphSnapshotDto {
  snapshotId: string;
  nodeCount?: number;
  edgeCount?: number;
  s3Url?: string;
  status?: 'stored' | 'invalidated' | 'expired';
}

export class GraphSnapshotDto {
  snapshotId: string;
  subtaskId: string;
  repoId: string;
  commitId?: string;
  language: string;
  graphType: string;
  version: number;
  createdAt: Date;
  nodeCount?: number;
  edgeCount?: number;
  s3Url?: string;
  status: 'stored' | 'invalidated' | 'expired';
}
