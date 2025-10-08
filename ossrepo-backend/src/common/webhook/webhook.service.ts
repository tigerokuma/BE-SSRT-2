import { Injectable } from '@nestjs/common';
import { Octokit } from '@octokit/rest';
import { PrismaService } from '../prisma/prisma.service';
import { GitHubService } from '../github/github.service';

@Injectable()
export class WebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly githubService: GitHubService,
  ) {}

  async setupWebhookForRepository(repositoryUrl: string, monitoredBranchId: string): Promise<string | null> {
    try {
      // Extract owner and repo from GitHub URL
      const match = repositoryUrl.match(/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?(?:\/.*)?$/);
      if (!match) {
        throw new Error(`Invalid GitHub repository URL: ${repositoryUrl}`);
      }

      const [, owner, repo] = match;
      console.log(`🔗 Setting up webhook for: ${owner}/${repo}`);

      // Check if webhook already exists for this repository
      const existingWebhook = await this.findExistingWebhook(owner, repo);
      if (existingWebhook) {
        console.log(`✅ Webhook already exists for ${owner}/${repo}: ${existingWebhook.id}`);
        // Update the monitored branch with the existing webhook ID
        await this.prisma.monitoredBranch.update({
          where: { id: monitoredBranchId },
          data: { webhook_id: existingWebhook.id.toString() },
        });
        console.log(`💾 Stored webhook ID ${existingWebhook.id} for monitored branch ${monitoredBranchId}`);
        return existingWebhook.id.toString();
      }

      // Get the authenticated Octokit instance
      const octokit = await this.githubService.getAuthenticatedOctokit();
      
      // Create webhook
      const webhookUrl = `${process.env.BACKEND_URL || 'https://3bc645a139d6.ngrok-free.app'}/webhooks/github`;
      
      const webhook = await octokit.repos.createWebhook({
        owner,
        repo,
        config: {
          url: webhookUrl,
          content_type: 'json',
          secret: process.env.GITHUB_WEBHOOK_SECRET || 'your-webhook-secret',
        },
        events: [
          'push',
          'pull_request',
          'release',
          'repository',
        ],
        active: true,
      });

      console.log(`✅ Webhook created successfully for ${owner}/${repo}:`, webhook.data.id);
      
      // Update the monitored branch with the new webhook ID
      await this.prisma.monitoredBranch.update({
        where: { id: monitoredBranchId },
        data: { webhook_id: webhook.data.id.toString() },
      });
      
      console.log(`💾 Stored new webhook ID ${webhook.data.id} for monitored branch ${monitoredBranchId}`);
      return webhook.data.id.toString();
      
    } catch (error) {
      console.error('Error setting up webhook:', error);
      throw error;
    }
  }

  async deleteWebhookForRepository(repositoryUrl: string): Promise<boolean> {
    try {
      // Extract owner and repo from GitHub URL
      const match = repositoryUrl.match(/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?(?:\/.*)?$/);
      if (!match) {
        console.log(`⚠️ Invalid GitHub repository URL: ${repositoryUrl}`);
        return false;
      }

      const [, owner, repo] = match;
      console.log(`🗑️ Deleting webhook for: ${owner}/${repo}`);

      // Get the webhook ID from the monitored branch
      const monitoredBranch = await this.prisma.monitoredBranch.findFirst({
        where: { repository_url: repositoryUrl },
        select: { webhook_id: true },
      });

      console.log(`🔍 Looking for webhook ID in database for: ${repositoryUrl}`);
      console.log(`📊 Found monitored branch:`, monitoredBranch);

      if (!monitoredBranch?.webhook_id) {
        console.log(`⚠️ No webhook ID found in database for repository: ${repositoryUrl}`);
        console.log(`🔍 Attempting to find webhook on GitHub directly...`);
        
        // Try to find the webhook directly on GitHub
        const existingWebhook = await this.findExistingWebhook(owner, repo);
        if (existingWebhook) {
          console.log(`✅ Found webhook on GitHub: ${existingWebhook.id}, updating database...`);
          // Update the database with the found webhook ID
          await this.prisma.monitoredBranch.updateMany({
            where: { repository_url: repositoryUrl },
            data: { webhook_id: existingWebhook.id.toString() },
          });
          // Continue with deletion using the found webhook ID
        } else {
          console.log(`⚠️ No webhook found on GitHub for repository: ${repositoryUrl}`);
          return false;
        }
      }

      // Get the authenticated Octokit instance
      const octokit = await this.githubService.getAuthenticatedOctokit();
      
      // Get the webhook ID (either from database or from the fallback search)
      const webhookId = monitoredBranch?.webhook_id || (await this.findExistingWebhook(owner, repo))?.id;
      
      if (!webhookId) {
        console.log(`⚠️ No webhook ID available for deletion: ${owner}/${repo}`);
        return false;
      }
      
      try {
        await octokit.repos.deleteWebhook({
          owner,
          repo,
          hook_id: parseInt(webhookId.toString()),
        });

        console.log(`✅ Webhook deleted successfully for ${owner}/${repo}`);
        
        // Clear the webhook ID from all monitored branches for this repository
        await this.prisma.monitoredBranch.updateMany({
          where: { repository_url: repositoryUrl },
          data: { webhook_id: null },
        });
        
        return true;
      } catch (deleteError) {
        if (deleteError.status === 404) {
          console.log(`⚠️ Webhook not found on GitHub (may have been deleted manually): ${owner}/${repo}`);
          // Clear the webhook ID from database even if it doesn't exist on GitHub
          await this.prisma.monitoredBranch.updateMany({
            where: { repository_url: repositoryUrl },
            data: { webhook_id: null },
          });
          return true;
        }
        throw deleteError;
      }
      
    } catch (error) {
      console.error('Error deleting webhook:', error);
      return false;
    }
  }

  private async findExistingWebhook(owner: string, repo: string): Promise<any> {
    try {
      const octokit = await this.githubService.getAuthenticatedOctokit();
      
      // Get all webhooks for the repository
      const webhooks = await octokit.repos.listWebhooks({
        owner,
        repo,
      });

      const webhookUrl = `${process.env.BACKEND_URL || 'https://3bc645a139d6.ngrok-free.app'}/webhooks/github`;
      
      // Find webhook with our URL
      const existingWebhook = webhooks.data.find(hook => 
        hook.config.url === webhookUrl
      );

      return existingWebhook || null;
    } catch (error) {
      console.error('Error checking for existing webhooks:', error);
      return null;
    }
  }

  async shouldDeleteWebhook(repositoryUrl: string, excludeProjectId?: string): Promise<boolean> {
    // Check if there are other active projects monitoring this repository
    const otherProjects = await this.prisma.project.count({
      where: {
        monitoredBranch: {
          repository_url: repositoryUrl,
        },
        status: {
          not: 'failed', // Don't count failed projects
        },
        // Exclude the current project being deleted
        ...(excludeProjectId && { id: { not: excludeProjectId } }),
      },
    });

    console.log(`🔍 Checking webhook deletion for ${repositoryUrl}: ${otherProjects} other projects found`);
    return otherProjects === 0;
  }

  async syncWebhookIdsForRepository(repositoryUrl: string): Promise<void> {
    try {
      // Extract owner and repo from GitHub URL
      const match = repositoryUrl.match(/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?(?:\/.*)?$/);
      if (!match) {
        console.log(`⚠️ Invalid GitHub repository URL: ${repositoryUrl}`);
        return;
      }

      const [, owner, repo] = match;
      
      // Find existing webhook on GitHub
      const existingWebhook = await this.findExistingWebhook(owner, repo);
      if (existingWebhook) {
        console.log(`🔄 Syncing webhook ID ${existingWebhook.id} for repository: ${repositoryUrl}`);
        
        // Update all monitored branches for this repository with the webhook ID
        await this.prisma.monitoredBranch.updateMany({
          where: { repository_url: repositoryUrl },
          data: { webhook_id: existingWebhook.id.toString() },
        });
        
        console.log(`✅ Synced webhook ID for repository: ${repositoryUrl}`);
      } else {
        console.log(`⚠️ No webhook found on GitHub for repository: ${repositoryUrl}`);
      }
    } catch (error) {
      console.error('Error syncing webhook IDs:', error);
    }
  }
}
