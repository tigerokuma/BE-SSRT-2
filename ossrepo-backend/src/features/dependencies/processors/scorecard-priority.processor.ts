import { Process, Processor } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface ScorecardPriorityJobData {
  packageId: string;
  packageName: string;
  repoUrl?: string;
  projectId: string;
}

@Injectable()
@Processor('scorecard-priority')
export class ScorecardPriorityProcessor {
  private readonly logger = new Logger(ScorecardPriorityProcessor.name);

  constructor(
    private prisma: PrismaService,
  ) {
    this.logger.log(`🔧 ScorecardPriorityProcessor initialized and ready to process jobs`);
  }

  @Process('scorecard-priority')
  async handleScorecardPriority(job: Job<ScorecardPriorityJobData>) {
    this.logger.log(`🔥 SCORECARD PROCESSOR TRIGGERED! Job ID: ${job.id}, Job Name: ${job.name}`);
    const { packageId, packageName, repoUrl, projectId } = job.data;
    
    this.logger.log(`🛡️ Starting priority scorecard analysis for package: ${packageName} (${packageId})`);
    
    try {
      // Update package status to processing
      await this.prisma.packages.update({
        where: { id: packageId },
        data: { status: 'processing' }
      });

      // Check if we have a repository URL
      if (!repoUrl) {
        this.logger.log(`⚠️ No repository URL provided for ${packageName} - skipping scorecard analysis`);
        
        await this.prisma.packages.update({
          where: { id: packageId },
          data: {
            status: 'done',
            scorecard_score: null,
            summary: `Package ${packageName} - No repository URL for scorecard analysis.`
          }
        });
        
        this.logger.log(`✅ Package ${packageName} completed without scorecard analysis`);
        return;
      }
      
      // Parse repository URL to get owner/repo
      const repoMatch = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
      if (!repoMatch) {
        this.logger.log(`⚠️ Invalid GitHub URL for ${packageName}: ${repoUrl} - skipping scorecard analysis`);
        
        await this.prisma.packages.update({
          where: { id: packageId },
          data: {
            status: 'done',
            scorecard_score: null,
            summary: `Package ${packageName} - Invalid GitHub URL for scorecard analysis.`
          }
        });
        
        this.logger.log(`✅ Package ${packageName} completed with invalid URL`);
        return;
      }
      
      const [, owner, repo] = repoMatch;
      this.logger.log(`🛡️ Running scorecard analysis for: ${owner}/${repo}`);
      
      // Get GitHub token from environment
      const githubToken = process.env.GITHUB_TOKEN;
      if (!githubToken) {
        throw new Error('GITHUB_TOKEN environment variable is not set');
      }
      
      // Run scorecard with optimized flags and GitHub token
      const scorecardCommand = `scorecard --repo=github.com/${owner}/${repo} --format=json --commit-depth=100 --checks=Maintained,Security-Policy,Vulnerabilities,Dangerous-Workflow`;
      this.logger.log(`🔧 Running scorecard command: ${scorecardCommand}`);
      this.logger.log(`🔐 Using GitHub token: ${githubToken.substring(0, 10)}...`);
      
      try {
        const { stdout, stderr } = await execAsync(scorecardCommand, {
          timeout: 300000, // 5 minutes timeout
          maxBuffer: 1024 * 1024 * 10, // 10MB buffer
          env: {
            ...process.env,
            GITHUB_AUTH_TOKEN: githubToken,
            GITHUB_TOKEN: githubToken,
          }
        });
        
        if (stderr) {
          this.logger.warn(`⚠️ Scorecard stderr: ${stderr}`);
        }
        
        // Parse scorecard output
        const scorecardData = JSON.parse(stdout);
        const score = scorecardData.score || 0;
        
        this.logger.log(`✅ Scorecard analysis completed for ${owner}/${repo}: ${score}/10`);
        this.logger.log(`📊 Scorecard details:`, {
          score: score,
          checks: scorecardData.checks?.length || 0,
          date: scorecardData.date
        });
        
        // Convert score from 0-10 scale to 0-100 scale
        const scorecardScore = Math.round(score * 10);
        
        // Update package with scorecard score
        await this.prisma.packages.update({
          where: { id: packageId },
          data: {
            status: 'done',
            scorecard_score: scorecardScore,
            summary: `Scorecard analysis completed. Score: ${scorecardScore}/100 (${score}/10). ${scorecardData.checks?.length || 0} checks performed.`
          }
        });
        
        this.logger.log(`✅ Scorecard priority analysis completed for package: ${packageName}`);
        
      } catch (scorecardError) {
        this.logger.error(`❌ Scorecard analysis failed for ${owner}/${repo}:`, scorecardError);
        
        // Update package with error status
        await this.prisma.packages.update({
          where: { id: packageId },
          data: {
            status: 'done',
            scorecard_score: null,
            summary: `Scorecard analysis failed: ${scorecardError.message}`
          }
        });
        
        this.logger.log(`⚠️ Package ${packageName} completed with scorecard error`);
      }
      
    } catch (error) {
      this.logger.error(`❌ Scorecard priority analysis failed for package ${packageName}:`, error);
      
      // Update package status to failed
      await this.prisma.packages.update({
        where: { id: packageId },
        data: { 
          status: 'failed',
          summary: `Scorecard analysis failed: ${error.message}`
        }
      });
      
      throw error;
    }
  }
}
