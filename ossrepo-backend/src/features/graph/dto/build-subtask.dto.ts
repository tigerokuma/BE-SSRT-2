// build-subtask.dto.ts

export class CreateBuildSubtaskDto {
  task_id: string;
  language: string;
  step: string;
  status?: string;
  message?: string;
}

export class UpdateBuildSubtaskDto {
  status?: string;
  message?: string;
  step?: string;
  started_at?: Date | null | undefined;
  finished_at?: Date | null | undefined;
}

export class BuildSubtaskDto {
  subtask_id: string;
  task_id: string;
  language: string;
  step: string;
  status: string;
  message?: string;
  created_at: Date | null | undefined;
  started_at?: Date | null | undefined;
  finished_at?: Date | null | undefined;
}
