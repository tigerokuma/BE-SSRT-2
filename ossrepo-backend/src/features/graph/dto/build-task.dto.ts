// build-task.dto.ts

export class CreateBuildTaskDto {
  repo_id: string;
  status?: string; // default: 'queued'
  logs?: string[];
  commit_id?: string;
  assigned_to?: string;
  retry_count?: number;
}

export class UpdateBuildTaskDto {
  status?: string;
  started_at?: Date | null | undefined;
  finished_at?: Date | null | undefined;
  logs?: string[];
  commit_id?: string;
  assigned_to?: string;
  retry_count?: number;
}

export class BuildTaskDto {
  task_id: string;
  repo_id: string;
  status: string;
  logs: string[];
  created_at: Date | null | undefined;
  started_at?: Date | null | undefined;
  finished_at?: Date | null | undefined;
  commit_id?: string;
  assigned_to?: string;
  retry_count: number;
}

export class TriggerBuildDto {
  commitId?: string;   // optional metadata for your DB / UI
  branch?: string;     // e.g. "main", "dev", etc.
  startSha?: string;   // used for incremental builds; null = use graph cursor
}