import { BuildTaskDto } from '../dto/build-task.dto';
import { BuildSubtaskDto } from '../dto/build-subtask.dto';
import { GraphSnapshotDto } from '../dto/graph-snapshot.dto';
import { GraphNodeDto } from '../dto/graph-node.dto';
import type { Node, Relationship } from 'neo4j-driver';

export function mapPrismaSubtaskToDto(row: any): BuildSubtaskDto {
  return {
    subtask_id: row.subtask_id,
    task_id: row.task_id,
    language: row.language,
    step: row.step,
    status: row.status,
    message: row.message ?? undefined,
    created_at: row.created_at ?? undefined,
    started_at: row.started_at ?? undefined,
    finished_at: row.finished_at ?? undefined,
  };
}

export function mapTaskToDto(task: any): BuildTaskDto {
  return {
    ...task,
    started_at: task.started_at ?? undefined,
    finished_at: task.finished_at ?? undefined,
    created_at: task.created_at ?? undefined,
    commit_id: task.commit_id ?? undefined,
    assigned_to: task.assigned_to ?? undefined,
  };
}

export function mapPrismaSnapshotToDto(row: any): GraphSnapshotDto {
  if (!row) return row;
  return {
    ...row,
    commit_id: row.commit_id ?? undefined,
    s3_url: row.s3_url ?? undefined,
    node_count: row.node_count ?? undefined,
    edge_count: row.edge_count ?? undefined,
  };
}

export function mapPrismaNodeToDto(n: any): GraphNodeDto {
  return {
    node_id: n.node_id,
    snapshot_id: n.snapshot_id,
    type: n.type,
    name: n.name ?? undefined,
    file_path: n.file_path ?? undefined,
    commit_id: n.commit_id ?? undefined,
    metadata: n.metadata ?? undefined,
  };
}

export function mapPrismaBuildTaskToDto(row: any): BuildTaskDto {
  if (!row) return row;
  return {
    ...row,
    commit_id: row.commit_id ?? undefined,
    assigned_to: row.assigned_to ?? undefined,
    started_at: row.started_at ?? undefined,
    finished_at: row.finished_at ?? undefined,
  };
}

function isRecordObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object';
}

function isNode(v: unknown): v is Node {
  return isRecordObject(v) && 'labels' in v && 'properties' in v;
}

function isRelationship(v: unknown): v is Relationship {
  return isRecordObject(v) && 'type' in v && 'properties' in v;
}

// Optional: flatten nested map/array returns from Cypher
export function iterAllValues(row: unknown): unknown[] {
  if (!isRecordObject(row)) return [];
  const values: unknown[] = [];
  for (const v of Object.values(row)) {
    if (Array.isArray(v)) values.push(...v);
    else if (isRecordObject(v)) values.push(...Object.values(v));
    else values.push(v);
  }
  return values;
}
