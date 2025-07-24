
export class CreateGraphSubtaskDto {
  taskId: string;
  language: string;
  step: string;
  status: string;
  message?: string;
}

export class UpdateGraphSubtaskDto {
  subtaskId: string;
  status?: string;
  message?: string;
  step?: string;
  startedAt?: Date | null;
  finishedAt?: Date | null;
}

export class GraphSubtaskDto {
  subtaskId: string;
  taskId: string;
  language: string;
  step: string;
  status: string;
  message?: string;
  createdAt: Date;
  startedAt?: Date | null;
  finishedAt?: Date | null;
}
