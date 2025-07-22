export class BuildStatusDto {
  repoId: string;
  buildTaskId: string;
  status: string;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  lastUpdated: Date;
}