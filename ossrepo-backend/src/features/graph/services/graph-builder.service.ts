// src/features/graph/services/graph-builder.service.ts
type PythonBuildResponse = {
  message: string;
  taskId: string;
  status: string;
};

import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import {
  CreateBuildSubtaskDto,
  BuildSubtaskDto,
  UpdateBuildSubtaskDto,
} from '../dto/build-subtask.dto';
import { GraphRepository } from '../repositories/graph.repository';
import { ConfigService } from '@nestjs/config';

interface TriggerBuildPayload {
  repoId: string;              // "owner/repo"
  taskId: string;
  branch?: string;             // default "main"
  repoPath?: string | null;    // optional local path
  startSha?: string | null;    // for incremental builds
}

@Injectable()
export class GraphBuilderService {
  private readonly baseUrl: string;
  private readonly internalToken?: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly repo: GraphRepository,
    private readonly config: ConfigService,
  ) {
    // e.g. GRAPH_BUILDER_URL=https://your-azure-graph-builder.azurecontainer.io
    this.baseUrl =
      process.env.GRAPH_BUILDER_URL ?? 'http://localhost:8080';
    this.internalToken = process.env.INTERNAL_API_TOKEN;
  }

  async triggerBuild(payload: TriggerBuildPayload): Promise<PythonBuildResponse> {
    const url = `${this.baseUrl}/internal/build`;

    const headers: Record<string, string> = {};
    if (this.internalToken) {
      headers['x-internal-token'] = this.internalToken;
    }

    console.log('[GraphBuilderService] POST', url, 'payload=', payload);

    try {
      const response$ = this.httpService.post<PythonBuildResponse>(url, payload, {
        headers,
      });
      const response = await firstValueFrom(response$);
      console.log(
        '[GraphBuilderService] Response from Python builder:',
        response.status,
        response.data,
      );
      return response.data;
    } catch (err: any) {
      console.error(
        '[GraphBuilderService] Error calling Python builder:',
        err?.response?.status,
        err?.response?.data ?? err.message,
      );
      throw err;
    }
  }


  // ----- SUBTASKS -----

  async createSubtask(dto: CreateBuildSubtaskDto): Promise<BuildSubtaskDto> {
    return this.repo.createGraphSubtask(dto);
  }

  async getSubtask(subtaskId: string): Promise<BuildSubtaskDto | null> {
    return this.repo.getGraphSubtaskById(subtaskId);
  }

  async getSubtasksByTask(taskId: string): Promise<BuildSubtaskDto[]> {
    return this.repo.getGraphSubtasksByTask(taskId);
  }

  async updateSubtask(
    subtaskId: string,
    dto: UpdateBuildSubtaskDto,
  ): Promise<BuildSubtaskDto> {
    return this.repo.updateGraphSubtask(subtaskId, dto);
  }

  async deleteSubtask(subtaskId: string): Promise<void> {
    return this.repo.deleteGraphSubtask(subtaskId);
  }
}
