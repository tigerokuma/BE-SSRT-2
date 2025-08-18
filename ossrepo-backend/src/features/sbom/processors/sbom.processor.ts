import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { SbomBuilderService } from '../services/sbom-builder.service';

@Processor('sbom')
export class SbomProcessor {
  constructor(private readonly sbomBuilderService: SbomBuilderService) {}

  @Process('full-process-sbom')
  async fullProcessSbom(job: Job<{ pkg: string; user: string }>) {
    const { pkg, user } = job.data;
    const created = await this.sbomBuilderService.addSbom(pkg);
    await this.sbomBuilderService.mergeSbom(user);
    return { created, mergedFor: user };
  }

  @Process('merge-sbom')
  async mergeSbom(job: Job<{ user: string }>) {
    const { user } = job.data;
    await this.sbomBuilderService.mergeSbom(user);
    return { mergedFor: user };
  }
}
