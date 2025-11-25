import { Injectable, Logger } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { Octokit } from '@octokit/rest';

@Injectable()
export class GitHubAppService {
  private readonly logger = new Logger(GitHubAppService.name);
  private readonly appId: string;
  private readonly privateKey: string;
  private readonly webhookSecret: string;

  constructor() {
    this.appId = process.env.GITHUB_APP_ID || '';
    this.privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n') || '';
    this.webhookSecret = process.env.GITHUB_APP_WEBHOOK_SECRET || '';
  }

  /**
   * Generate JWT token for GitHub App authentication
   */
  private generateJWT(): string {
    if (!this.appId || !this.privateKey) {
      throw new Error('GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must be set');
    }

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iat: now - 60, // Issued at time (1 minute ago to account for clock skew)
      exp: now + 60 * 9, // Expires in 9 minutes (GitHub max is 10 minutes, so use 9 to be safe)
      iss: this.appId, // Issuer (GitHub App ID)
    };

    return jwt.sign(payload, this.privateKey, { algorithm: 'RS256' });
  }

  /**
   * Get installation access token for a specific installation
   */
  async getInstallationToken(installationId: string): Promise<string> {
    try {
      const jwt = this.generateJWT();
      const octokit = new Octokit({ auth: jwt });

      const response = await octokit.apps.createInstallationAccessToken({
        installation_id: parseInt(installationId),
      });

      return response.data.token;
    } catch (error) {
      this.logger.error(`Error getting installation token for ${installationId}:`, error);
      throw error;
    }
  }

  /**
   * Get authenticated Octokit instance for a specific installation
   */
  async getAuthenticatedOctokit(installationId: string): Promise<Octokit> {
    const token = await this.getInstallationToken(installationId);
    return new Octokit({ auth: token });
  }

  /**
   * Find existing bot comment on a PR
   */
  async findExistingBotComment(
    installationId: string,
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<number | null> {
    try {
      const octokit = await this.getAuthenticatedOctokit(installationId);

      // Get all comments on the PR
      const { data: comments } = await octokit.issues.listComments({
        owner,
        repo,
        issue_number: prNumber,
      });

      // Find comment that starts with our marker
      const botComment = comments.find(
        (comment) =>
          comment.user?.type === 'Bot' &&
          comment.body?.startsWith('## Package Changes Detected'),
      );

      return botComment ? botComment.id : null;
    } catch (error) {
      this.logger.error(`Error finding existing bot comment:`, error);
      return null;
    }
  }

  /**
   * Post or update a comment on a pull request
   * Updates existing comment if found, otherwise creates new one
   */
  async postPRComment(
    installationId: string,
    owner: string,
    repo: string,
    prNumber: number,
    comment: string,
  ): Promise<void> {
    try {
      const octokit = await this.getAuthenticatedOctokit(installationId);

      // Try to find existing bot comment
      const existingCommentId = await this.findExistingBotComment(
        installationId,
        owner,
        repo,
        prNumber,
      );

      if (existingCommentId) {
        // Update existing comment
        await octokit.issues.updateComment({
          owner,
          repo,
          comment_id: existingCommentId,
          body: comment,
        });

        this.logger.log(`Updated existing comment on PR #${prNumber} in ${owner}/${repo}`);
      } else {
        // Create new comment
        await octokit.issues.createComment({
          owner,
          repo,
          issue_number: prNumber,
          body: comment,
        });

        this.logger.log(`Posted new comment on PR #${prNumber} in ${owner}/${repo}`);
      }
    } catch (error) {
      this.logger.error(`Error posting/updating PR comment:`, error);
      throw error;
    }
  }

  /**
   * Get PR diff/files changed
   */
  async getPRFiles(
    installationId: string,
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<any[]> {
    try {
      const octokit = await this.getAuthenticatedOctokit(installationId);

      const { data } = await octokit.pulls.listFiles({
        owner,
        repo,
        pull_number: prNumber,
      });

      return data;
    } catch (error) {
      this.logger.error(`Error getting PR files:`, error);
      throw error;
    }
  }

  /**
   * Get PR diff content
   */
  async getPRDiff(
    installationId: string,
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<string> {
    try {
      const octokit = await this.getAuthenticatedOctokit(installationId);

      const { data } = await octokit.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
      });

      // Get the diff using the compare API
      const { data: diffData } = await octokit.repos.compareCommits({
        owner,
        repo,
        base: data.base.sha,
        head: data.head.sha,
      });

      // Get the actual diff
      const diffResponse = await fetch(diffData.diff_url);
      return await diffResponse.text();
    } catch (error) {
      this.logger.error(`Error getting PR diff:`, error);
      throw error;
    }
  }

  /**
   * Find installation ID for a specific repository
   * Returns null if no installation found
   */
  async findInstallationForRepository(repositoryUrl: string): Promise<string | null> {
    try {
      if (!this.appId || !this.privateKey) {
        this.logger.warn('GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY not set, cannot find installation');
        return null;
      }

      // Parse repository URL to get owner and repo
      const urlMatch = repositoryUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
      if (!urlMatch) {
        this.logger.warn(`Invalid GitHub repository URL: ${repositoryUrl}`);
        return null;
      }

      const [, owner, repo] = urlMatch;
      const jwt = this.generateJWT();
      const octokit = new Octokit({ auth: jwt });

      try {
        const { data: installation } = await octokit.apps.getRepoInstallation({
          owner,
          repo,
        });

        this.logger.log(`Found installation ${installation.id} for repository ${owner}/${repo}`);
        return installation.id.toString();
      } catch (error: any) {
        if (error.status === 404) {
          this.logger.log(`No installation found for repository ${owner}/${repo}`);
          return null;
        }
        throw error;
      }
    } catch (error) {
      this.logger.error(`Error finding installation for repository ${repositoryUrl}:`, error);
      return null;
    }
  }

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(payload: string | Buffer, signature: string): boolean {
    if (!this.webhookSecret) {
      this.logger.warn('GITHUB_APP_WEBHOOK_SECRET not set, skipping signature verification');
      return true;
    }

    if (!signature) {
      this.logger.warn('No signature provided in webhook');
      return false;
    }

    const crypto = require('crypto');
    const payloadBuffer = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
    const hmac = crypto.createHmac('sha256', this.webhookSecret);
    const digest = 'sha256=' + hmac.update(payloadBuffer).digest('hex');

    // Remove 'sha256=' prefix from signature if present
    const signatureValue = signature.startsWith('sha256=') ? signature : `sha256=${signature}`;

    try {
      return crypto.timingSafeEqual(
        Buffer.from(signatureValue),
        Buffer.from(digest),
      );
    } catch (error) {
      this.logger.error('Error verifying webhook signature:', error);
      return false;
    }
  }
}

