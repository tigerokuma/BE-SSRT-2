import { Injectable } from '@nestjs/common';
import { GraphRepository } from '../repositories/graph.repository';
import { TriggerBuildDto } from '../dto/trigger-build.dto';
import { BuildResponseDto } from '../dto/build-response.dto';

@Injectable()
export class GraphService {
  constructor(private readonly repo: GraphRepository) {}

  async triggerBuild(repoId: string, dto: TriggerBuildDto): Promise<BuildResponseDto> {
    const buildTask = await this.repo.createBuildTask(repoId, dto.commitId);
    return {
      message: 'Build triggered',
      repoId,
      status: buildTask.status,
      buildTaskId: buildTask.task_id,
    };
  }
}