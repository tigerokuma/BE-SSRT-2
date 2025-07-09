import {Controller, Post, Get, Param, Body, Query} from '@nestjs/common';
import {GraphService} from '../services/graph.service';
import {TriggerBuildDto} from '../dto/trigger-build.dto';
import {BuildResponseDto} from '../dto/build-response.dto';
import {BuildStatusDto} from '../dto/build-status.dto';
import { ExportGraphDto } from '../dto/export-graph.dto';

@Controller('graph')
export class GraphController {
    constructor(private readonly graphService: GraphService) {
    }

    @Post('build/:repoId')
    async triggerBuild(
        @Param('repoId') repoId: string,
        @Body() dto: TriggerBuildDto
    ): Promise<BuildResponseDto> {
        return this.graphService.triggerBuild(repoId, dto);
    }

    @Get('status/:repoId')
    async getBuildStatus(@Param('repoId') repoId: string): Promise<BuildStatusDto | null> {
        return this.graphService.getBuildStatus(repoId);
    }

    @Get('export/:repoId')
    async getExport(
        @Param('repoId') repoId: string,
        @Query('format') format?: string
    ): Promise<ExportGraphDto | null> {
        return this.graphService.getExport(repoId, format || 'graphml');
    }
}