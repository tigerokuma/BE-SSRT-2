
import { GraphSnapshotDto } from '../dto/graph-snapshot.dto';
import { GraphSubtaskDto } from '../dto/graph-subtask.dto';

export function mapPrismaSnapshotToDto(prisma: any): GraphSnapshotDto {
  return {
    snapshotId: prisma.snapshot_id,
    subtaskId: prisma.subtask_id,
    repoId: prisma.repo_id,
    commitId: prisma.commit_id,
    language: prisma.language,
    graphType: prisma.graph_type,
    version: prisma.version,
    createdAt: prisma.created_at,
    nodeCount: prisma.node_count,
    edgeCount: prisma.edge_count,
    s3Url: prisma.s3_url,
    status: prisma.status,
  };
}

export function mapPrismaSubtaskToDto(row: any): GraphSubtaskDto {
  return {
    subtaskId: row.subtask_id,
    taskId: row.task_id,
    language: row.language,
    step: row.step,
    status: row.status,
    message: row.message,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}