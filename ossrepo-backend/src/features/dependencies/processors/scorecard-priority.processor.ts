import { Process, Processor } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConnectionService } from '../../../common/azure/azure.service';

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
    private azureService: ConnectionService,
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
      const scorecardCommand = `docker run --rm gcr.io/openssf/scorecard:stable --repo=github.com/${owner}/${repo} --format=json --commit-depth=100 --checks=Maintained,Security-Policy,Vulnerabilities,Dangerous-Workflow`;
      this.logger.log(`🔧 Running scorecard command: ${scorecardCommand}`);
      this.logger.log(`🔐 Using GitHub token: ${githubToken.substring(0, 10)}...`);
      
      try {
        const { stdout, stderr } = await this.azureService.executeRemoteCommand(scorecardCommand, {
          env: {
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
          date: scorecardData.date,
          commit: scorecardData.commit,
          commitDate: scorecardData.commitDate
        });
        
        // Convert score from 0-10 scale to 0-100 scale
        const scorecardScore = Math.round(score * 10);
        
        // Get the commit date from scorecard data or fallback to latest commit
        let commitDate = new Date();
        
        if (scorecardData.commitDate) {
          // Use the commit date from scorecard output if available
          commitDate = new Date(scorecardData.commitDate);
          this.logger.log(`📅 Using commit date from scorecard: ${commitDate.toISOString()}`);
        } else if (scorecardData.commit) {
          // Try to find the specific commit in our database
          const specificCommit = await this.prisma.packageCommit.findFirst({
            where: { 
              package_id: packageId,
              sha: scorecardData.commit
            }
          });
          
          if (specificCommit) {
            commitDate = specificCommit.timestamp;
            this.logger.log(`📅 Using commit date from database for SHA ${scorecardData.commit}: ${commitDate.toISOString()}`);
          } else {
            // Fallback to latest commit
            const latestCommit = await this.prisma.packageCommit.findFirst({
              where: { package_id: packageId },
              orderBy: { timestamp: 'desc' }
            });
            commitDate = latestCommit?.timestamp || new Date();
            this.logger.log(`📅 Using latest commit date as fallback: ${commitDate.toISOString()}`);
          }
        } else {
          // Try to get commit date from GitHub API
          try {
            const githubToken = process.env.GITHUB_TOKEN;
            if (githubToken && scorecardData.commit) {
              const githubResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits/${scorecardData.commit}`, {
                headers: {
                  'Authorization': `token ${githubToken}`,
                  'Accept': 'application/vnd.github.v3+json'
                }
              });
              
              if (githubResponse.ok) {
                const commitData = await githubResponse.json();
                commitDate = new Date(commitData.commit.committer.date);
                this.logger.log(`📅 Using commit date from GitHub API: ${commitDate.toISOString()}`);
              } else {
                throw new Error(`GitHub API returned ${githubResponse.status}`);
              }
            } else {
              throw new Error('No GitHub token or commit SHA available');
            }
          } catch (githubError) {
            this.logger.warn(`⚠️ Failed to get commit date from GitHub API: ${githubError.message}`);
            
            // Fallback to latest commit
            const latestCommit = await this.prisma.packageCommit.findFirst({
              where: { package_id: packageId },
              orderBy: { timestamp: 'desc' }
            });
            commitDate = latestCommit?.timestamp || new Date();
            this.logger.log(`📅 Using latest commit date as fallback: ${commitDate.toISOString()}`);
          }
        }
        
        // Create scorecard history entry
        await this.prisma.packageScorecardHistory.create({
          data: {
            package_id: packageId,
            commit_sha: scorecardData.commit || 'unknown',
            commit_date: commitDate,
            score: scorecardScore,
            scorecard_data: scorecardData,
            source: 'local'
          }
        });
        
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
