
import { BuildTaskDto } from '../dto/build-task.dto';
import { BuildSubtaskDto } from '../dto/build-subtask.dto';
import { GraphSnapshotDto } from '../dto/graph-snapshot.dto';
import { GraphNodeDto } from '../dto/graph-node.dto';


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