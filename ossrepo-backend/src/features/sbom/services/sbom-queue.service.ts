import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

@Injectable()
export class SbomQueueService {
  constructor(
    @InjectQueue('sbom') private readonly sbomQueue: Queue,
  ) {}

  async mergeSbom(user: string) {
    await this.sbomQueue.add('merge-sbom', { user });
  }

  async fullProcessSbom(pkg: string, user: string) {
    await this.sbomQueue.add('full-process-sbom', { pkg, user });
  }
}
