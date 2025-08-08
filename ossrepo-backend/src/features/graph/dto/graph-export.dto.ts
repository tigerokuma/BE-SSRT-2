// graph-export.dto.ts

export class CreateGraphExportDto {
  repo_id: string;
  format: string;
  status: string;
  s3_url?: string;
  actor?: string;
}

export class UpdateGraphExportDto {
  status?: string;
  ready_time?: Date | null | undefined;
  s3_url?: string;
  actor?: string;
}

export class GraphExportDto {
  export_id: string;
  repo_id: string;
  format: string;
  ready_time?: Date | null | undefined;
  s3_url?: string;
  status: string;
  actor?: string;
  created_at: Date | null | undefined;
}
