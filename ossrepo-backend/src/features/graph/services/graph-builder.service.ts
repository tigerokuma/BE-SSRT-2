type PythonBuildResponse = {
    message: string;
    taskId: string;
    status: string;
};

import {Injectable} from '@nestjs/common';
import {HttpService} from '@nestjs/axios';
import {firstValueFrom} from 'rxjs';
import {CreateGraphSubtaskDto, GraphSubtaskDto, UpdateGraphSubtaskDto} from '../dto/graph-subtask.dto';
import { GraphRepository } from '../repositories/graph.repository';

// Import DTOs as above

@Injectable()
export class GraphBuilderService {
    constructor(private readonly httpService: HttpService, private readonly repo: GraphRepository) {
    }

    async triggerBuild(payload: any): Promise<PythonBuildResponse> {
        const url = 'http://localhost:8080/internal/build';
        const response$ = this.httpService.post<PythonBuildResponse>(url, payload);
        const response = await firstValueFrom(response$);
        return response.data;
    }

    // ----- SUBTASKS -----

    async createSubtask(dto: CreateGraphSubtaskDto): Promise<GraphSubtaskDto> {
        return this.repo.createGraphSubtask(dto);
    }

    async getSubtask(subtaskId: string): Promise<GraphSubtaskDto | null> {
        return this.repo.getGraphSubtaskById(subtaskId);
    }

    async getSubtasksByTask(taskId: string): Promise<GraphSubtaskDto[]> {
        return this.repo.getGraphSubtasksByTask(taskId);
    }

    async updateSubtask(subtaskId: string, dto: UpdateGraphSubtaskDto): Promise<GraphSubtaskDto> {
        return this.repo.updateGraphSubtask(subtaskId, dto);
    }

    async deleteSubtask(subtaskId: string): Promise<void> {
        return this.repo.deleteGraphSubtask(subtaskId);
    }
}