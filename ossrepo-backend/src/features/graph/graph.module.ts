import { Module } from '@nestjs/common';
import { GraphController } from './controllers/graph.controller';
import { GraphService } from './services/graph.service';
import { GraphBuilderService } from './services/graph-builder.service';
import { GraphRepository } from './repositories/graph.repository';
import { GraphStorageService } from './services/graph-storage.service';
import { HttpModule } from '@nestjs/axios';
@Module({
  controllers: [GraphController],
  imports: [HttpModule],
  providers: [
    GraphService,
    GraphBuilderService,
    GraphRepository,
    GraphStorageService,
  ],
  exports: [GraphService],
})
export class GraphModule {}
