import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

@Injectable()
export class DependencyQueueService {
  private readonly logger = new Logger(DependencyQueueService.name);

  constructor(
    @InjectQueue('dependency-fast-setup') private fastSetupQueue: Queue,
    @InjectQueue('dependency-full-setup') private fullSetupQueue: Queue,
    @InjectQueue('scorecard-priority') private scorecardPriorityQueue: Queue,
    @InjectQueue('scorecard-background') private scorecardBackgroundQueue: Queue,
  ) {}

  async queueFastSetup(data: {
    packageId?: string;
    branchDependencyId?: string;
    branchId?: string;
    packageName: string;
    repoUrl?: string;
    projectId: string;
  }) {
    this.logger.log(`📦 Queuing fast setup for package: ${data.packageName}`);
    this.logger.log(`🔍 Queue name: dependency-fast-setup`);
    this.logger.log(`🔍 Job name: fast-setup`);
    this.logger.log(`🔍 Job data:`, JSON.stringify(data, null, 2));
    
    // Generate unique jobId to prevent duplicates
    const jobId = `fast-setup-${data.packageName}-${data.projectId}${data.branchDependencyId ? `-${data.branchDependencyId}` : ''}`;
    
    // Check if job already exists
    const existingJob = await this.fastSetupQueue.getJob(jobId);
    if (existingJob) {
      const state = await existingJob.getState();
      if (state === 'active' || state === 'waiting' || state === 'delayed') {
        this.logger.log(`⚠️ Fast setup job already exists for ${data.packageName}, skipping duplicate`);
        return existingJob;
      }
    }
    
    const job = await this.fastSetupQueue.add('fast-setup', data, {
      jobId, // Unique ID to prevent duplicates
      priority: 10, // High priority for fast setup
      delay: 0, // Start immediately
      removeOnComplete: 100, // Keep last 100 completed jobs for visibility
      removeOnFail: false, // Keep failed jobs for debugging
    });

    this.logger.log(`✅ Fast setup job queued: ${job.id}`);
    this.logger.log(`🔍 Job details:`, {
      id: job.id,
      name: job.name,
      data: job.data,
      opts: job.opts
    });
    return job;
  }

  async queueFullSetup(data: {
    packageId: string;
    packageName: string;
    repoUrl?: string;
    projectId: string;
  }) {
    this.logger.log(`📦 Queuing full setup for package: ${data.packageName}`);
    
    // Generate unique jobId to prevent duplicates
    const jobId = `full-setup-${data.packageId}-${data.projectId}`;
    
    // Check if job already exists
    const existingJob = await this.fullSetupQueue.getJob(jobId);
    if (existingJob) {
      const state = await existingJob.getState();
      if (state === 'active' || state === 'waiting' || state === 'delayed') {
        this.logger.log(`⚠️ Full setup job already exists for ${data.packageName}, skipping duplicate`);
        return existingJob;
      }
    }
    
    const job = await this.fullSetupQueue.add('full-setup', data, {
      jobId, // Unique ID to prevent duplicates
      priority: 5, // Medium priority for full setup
      delay: 5000, // Wait 5 seconds before starting
      removeOnComplete: 100, // Keep last 100 completed jobs for visibility
      removeOnFail: false, // Keep failed jobs for debugging
    });

    this.logger.log(`✅ Full setup job queued: ${job.id}`);
    return job;
  }

  async queueScorecardPriority(data: {
    packageId: string;
    packageName: string;
    repoUrl?: string;
    projectId: string;
  }) {
    this.logger.log(`📦 Queuing priority scorecard for package: ${data.packageName}`);
    
    const job = await this.scorecardPriorityQueue.add('scorecard-priority', data, {
      priority: 15, // Highest priority
      delay: 0,
    });

    this.logger.log(`✅ Priority scorecard job queued: ${job.id}`);
    return job;
  }

  async queueScorecardBackground(data: {
    packageId: string;
    packageName: string;
    repoUrl?: string;
    projectId: string;
  }) {
    this.logger.log(`📦 Queuing background scorecard for package: ${data.packageName}`);
    
    const job = await this.scorecardBackgroundQueue.add('scorecard-background', data, {
      priority: 1, // Low priority
      delay: 30000, // Wait 30 seconds before starting
    });

    this.logger.log(`✅ Background scorecard job queued: ${job.id}`);
    return job;
  }
}
