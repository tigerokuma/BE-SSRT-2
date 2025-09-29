import { Module } from '@nestjs/common';
import { GraphController } from './controllers/graph.controller';
import { GraphService } from './services/graph.service';
import { GraphBuilderService } from './services/graph-builder.service';
import { GraphRepository } from './repositories/graph.repository';
import { GraphStorageService } from './services/graph-storage.service';
import { HttpModule } from '@nestjs/axios';
import { LlmService } from './services/llm.service';
import { MemgraphService } from './services/memgraph.service';
@Module({
  controllers: [GraphController],
  imports: [HttpModule],
  providers: [
    GraphService,
    GraphBuilderService,
    GraphRepository,
    GraphStorageService,
    LlmService,
    MemgraphService,
  ],
  exports: [GraphService],
})
export class GraphModule {}
