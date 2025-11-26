import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

@Injectable()
export class SbomQueueService {
  constructor(@InjectQueue('sbom') private readonly sbomQueue: Queue) {}


  /**
   * Queue full SBOM process job for a package (generates SBOM and stores in Memgraph)
   * This matches the generate-SBOM endpoint behavior
   */
  async fullProcessSbom(package_id: string, version?: string) {
    await this.sbomQueue.add('full-process-sbom', { package_id, version });
  }
}
