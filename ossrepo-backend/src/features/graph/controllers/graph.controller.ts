import { Controller, Post, Param, Body } from '@nestjs/common';
import { GraphService } from '../services/graph.service';
import { TriggerBuildDto } from '../dto/trigger-build.dto';
import { BuildResponseDto } from '../dto/build-response.dto';

@Controller('graph')
export class GraphController {
  constructor(private readonly graphService: GraphService) {}

  @Post('build/:repoId')
  async triggerBuild(
    @Param('repoId') repoId: string,
    @Body() dto: TriggerBuildDto
  ): Promise<BuildResponseDto> {
    return this.graphService.triggerBuild(repoId, dto);
  }
}