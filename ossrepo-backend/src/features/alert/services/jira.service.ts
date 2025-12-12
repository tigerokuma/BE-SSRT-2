import { Injectable, BadRequestException, BadGatewayException } from '@nestjs/common';
import { JiraRepository } from '../repositories/jira.repository';
import { randomBytes, randomUUID } from 'crypto';
import { UserService } from '../../user/user.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { createClerkClient } from '@clerk/backend';

const clerk = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY!,
});

@Injectable()
export class JiraService {
  constructor(
    private jiraRepository: JiraRepository,
    private userService: UserService,
    private prisma: PrismaService,
  ) {}

  redirectToJira(res: any, clerkId: string, type: 'user' | 'project' = 'user', projectId?: string) {
    const state = randomUUID();
    
    // Store state with clerk_id and type (user or project)
    // For project connections, also include projectId
    const stateData: any = { state, clerkId, type };
    if (type === 'project' && projectId && projectId.trim() !== '') {
      stateData.projectId = projectId.trim();
    }
    const stateWithUser = Buffer.from(JSON.stringify(stateData)).toString('base64');

    const jiraBaseUrl = process.env.JIRA_BASE_URL || 'https://open-source-insight-tracker.vercel.app';
    const redirectUri = `${jiraBaseUrl}/jira/oauth/callback`;

    const url =
      'https://auth.atlassian.com/authorize?' +
      new URLSearchParams({
        audience: 'api.atlassian.com',
        client_id: process.env.ATLASSIAN_CLIENT_ID || '',
        scope:
          'read:jira-work write:jira-work read:jira-user offline_access',
        redirect_uri: redirectUri,
        state: stateWithUser,
        response_type: 'code',
        prompt: 'consent',
      });

    return res.redirect(url);
  }

  // --------------------------------------------------------
  // 2. HANDLE OAUTH CALLBACK
  // --------------------------------------------------------
  async handleOAuthCallback(req: any, query: any, res: any) {
    const code = query.code;
    const state = query.state;

    if (!code) {
      throw new BadRequestException('Missing authorization code');
    }

    if (!state) {
      throw new BadRequestException('Missing state parameter');
    }

    // Decode state to get clerk_id, type, and optionally projectId
    let userClerkId: string | null = null;
    let connectionType: 'user' | 'project' = 'user';
    let projectId: string | null = null;
    try {
      const decoded = JSON.parse(Buffer.from(state, 'base64').toString());
      userClerkId = decoded.clerkId || null;
      connectionType = decoded.type || 'user';
      projectId = decoded.projectId || null;
      
      // Validate projectId if it exists
      if (projectId && (typeof projectId !== 'string' || projectId.trim() === '')) {
        projectId = null;
      } else if (projectId) {
        projectId = projectId.trim();
      }
    } catch (e) {
      throw new BadRequestException('Invalid state parameter');
    }

    if (!userClerkId) {
      throw new BadRequestException('Could not extract user ID from state');
    }

    if (connectionType === 'project' && (!projectId || projectId.trim() === '')) {
      throw new BadRequestException('Project ID is required for project-level connections');
    }

    const frontendUrl = process.env.FRONTEND_URL || 'https://open-source-insight-tracker.vercel.app';
    // The callback goes to the frontend route which proxies to the backend
    const jiraBaseUrl = process.env.JIRA_BASE_URL || 'https://open-source-insight-tracker.vercel.app';
    const redirectUri = `${jiraBaseUrl}/jira/oauth/callback`;

    // Exchange code for tokens
    const tokenRes = await fetch('https://auth.atlassian.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: process.env.ATLASSIAN_CLIENT_ID,
        client_secret: process.env.ATLASSIAN_CLIENT_SECRET,
        redirect_uri: redirectUri,
        code,
      }),
    });

    if (!tokenRes.ok) {
      const errorText = await tokenRes.text();
      throw new BadGatewayException(`Failed to exchange code for token: ${errorText}`);
    }

    const tokens = await tokenRes.json();
    const accessToken = tokens.access_token;

    if (!accessToken) {
      throw new BadGatewayException('No access token received from Jira');
    }

    // Get Jira Cloud sites
    const sitesRes = await fetch(
      'https://api.atlassian.com/oauth/token/accessible-resources',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );

    if (!sitesRes.ok) {
      throw new BadGatewayException('Failed to fetch Jira accessible resources');
    }

    const sites = await sitesRes.json();

    if (!sites || sites.length === 0) {
      throw new BadGatewayException('No Jira sites found for this account');
    }

    const cloudId = sites[0]?.id;
    if (!cloudId) {
      throw new BadGatewayException('No cloud ID found in Jira sites response');
    }

    // Store tokens + cloudId in DB based on connection type
    if (connectionType === 'project' && projectId) {
      await this.saveProjectJiraConnection(projectId, {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        cloud_id: cloudId,
      });
      // For project connections, redirect to project selection page to choose Jira project
      // Ensure projectId is valid before redirecting
      if (!projectId || projectId.trim() === '') {
        // Fallback to settings page if projectId is invalid
        return res.redirect(`${frontendUrl}/settings?jira_connected=true`);
      }
      // Redirect to Jira project selection page with project_id parameter
      // Use URLSearchParams to properly encode the query parameters
      try {
        const redirectUrl = new URL('/jira/select-project', frontendUrl);
        redirectUrl.searchParams.set('cloud_id', cloudId);
        redirectUrl.searchParams.set('project_id', projectId);
        return res.redirect(redirectUrl.toString());
      } catch (error) {
        // Fallback to manual URL construction if URL parsing fails
        const separator = frontendUrl.includes('?') ? '&' : '?';
        return res.redirect(`${frontendUrl}/jira/select-project${separator}cloud_id=${encodeURIComponent(cloudId)}&project_id=${encodeURIComponent(projectId)}`);
      }
    } else {
      // User-level connection
      await this.saveUserJiraConnection(userClerkId!, {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        cloud_id: cloudId,
      });
      // Redirect to project selection page
      // Use URLSearchParams to properly encode the query parameters
      try {
        const redirectUrl = new URL('/jira/select-project', frontendUrl);
        redirectUrl.searchParams.set('cloud_id', cloudId);
        return res.redirect(redirectUrl.toString());
      } catch (error) {
        // Fallback to manual URL construction if URL parsing fails
        const separator = frontendUrl.includes('?') ? '&' : '?';
        return res.redirect(`${frontendUrl}/jira/select-project${separator}cloud_id=${encodeURIComponent(cloudId)}`);
      }
    }
  }

  // --------------------------------------------------------
  // 3. GET PROJECTS
  // --------------------------------------------------------
  async getProjects(clerkUserId: string, cloudId?: string) {
    // Get access token from database (stored during OAuth callback)
    const accessToken = await this.getJiraAccessTokenFromDatabase(clerkUserId);
    if (!accessToken) {
      throw new Error('Jira access token not found. Please reconnect your Jira account.');
    }

    // Use provided cloudId or get from existing connection
    let targetCloudId = cloudId;
    if (!targetCloudId) {
      try {
        const creds = await this.getUserJiraConnection(clerkUserId);
        targetCloudId = creds.cloud_id;
      } catch (err) {
        throw new Error('Jira not connected. Please connect your Jira account first.');
      }
    }

    const response = await fetch(
      `https://api.atlassian.com/ex/jira/${targetCloudId}/rest/api/3/project/search`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    return response.json();
  }

  // --------------------------------------------------------
  // 6. UPDATE SELECTED PROJECT
  // --------------------------------------------------------
  async updateSelectedProject(clerkUserId: string, projectKey: string) {
    // Get backend user_id from clerk_id
    const user = await this.userService.getUserByClerkId(clerkUserId);
    if (!user) {
      throw new Error(`User not found for clerk_id: ${clerkUserId}`);
    }

    // Get existing Jira connection
    const jiraInfo = await this.jiraRepository.getJiraInfoUser(user.user_id);
    if (!jiraInfo) {
      throw new Error('Jira connection not found. Please connect your Jira account first.');
    }

    // Update project_key
    await this.jiraRepository.insertJiraInfo({
      user_id: user.user_id,
      webtrigger_url: jiraInfo.webtrigger_url,
      project_key: projectKey,
    });

    return { success: true, project_key: projectKey };
  }

  // --------------------------------------------------------
  // 4. CREATE ISSUE
  // --------------------------------------------------------
  async createIssue(clerkUserId: string, body) {
    const creds = await this.getUserJiraConnection(clerkUserId);
    
    // Get access token from database (stored during OAuth callback)
    const accessToken = await this.getJiraAccessTokenFromDatabase(clerkUserId);
    if (!accessToken) {
      throw new Error('Jira access token not found. Please reconnect your Jira account.');
    }

    const response = await fetch(
      `https://api.atlassian.com/ex/jira/${creds.cloud_id}/rest/api/3/issue`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fields: {
            summary: body.summary,
            project: { key: body.projectKey },
            issuetype: { name: 'Task' },
          },
        }),
      },
    );

    return response.json();
  }

  // --------------------------------------------------------
  // DATABASE HELPERS
  // --------------------------------------------------------
  async saveUserJiraConnection(clerkUserId: string, data: {
    access_token: string;
    refresh_token: string;
    cloud_id: string;
  }) {
    // Get backend user_id from clerk_id
    const user = await this.userService.getUserByClerkId(clerkUserId);
    if (!user) {
      throw new Error(`User not found for clerk_id: ${clerkUserId}`);
    }

    // Construct webtrigger_url from cloud_id
    const webtrigger_url = `https://api.atlassian.com/ex/jira/${data.cloud_id}/rest/api/3`;
    
    // Save connection info without project_key - user will select it later
    // If a project_key is provided in data, use it; otherwise leave it null
    const project_key = (data as any).project_key || null;
    
    // Save to database (with or without project_key)
    await this.jiraRepository.insertJiraInfo({
      user_id: user.user_id,
      webtrigger_url,
      project_key,
    });

    // Store tokens in User table using dedicated Jira token fields
    try {
      await this.jiraRepository.updateUserJiraTokens(
        user.user_id,
        data.access_token,
        data.refresh_token,
      );
    } catch (err) {
      console.warn('Failed to store Jira tokens in User table:', err);
      // Continue even if token storage fails - connection info is still saved
    }

      return {
      user_id: user.user_id,
      cloud_id: data.cloud_id,
      project_key: project_key || null,
    };
  }

  async getUserJiraConnection(clerkUserId: string) {
    // Get backend user_id from clerk_id
    const user = await this.userService.getUserByClerkId(clerkUserId);
    if (!user) {
      throw new Error(`User not found for clerk_id: ${clerkUserId}`);
    }

    // Get Jira info from database
    const jiraInfo = await this.jiraRepository.getJiraInfoUser(user.user_id);
    if (!jiraInfo) {
      throw new Error(`Jira connection not found for user: ${clerkUserId}`);
    }

    // Extract cloud_id from webtrigger_url
    // Format: https://api.atlassian.com/ex/jira/{cloud_id}/rest/api/3
    const cloudIdMatch = jiraInfo.webtrigger_url.match(/\/ex\/jira\/([^\/]+)\//);
    const cloud_id = cloudIdMatch ? cloudIdMatch[1] : null;

    if (!cloud_id) {
      throw new Error(`Invalid webtrigger_url format: ${jiraInfo.webtrigger_url}`);
    }

    // Note: To get access_token, you need to retrieve it from Clerk
    // This is a placeholder - you'll need to implement token retrieval from Clerk
    return {
      cloud_id,
      project_key: jiraInfo.project_key,
      webtrigger_url: jiraInfo.webtrigger_url,
      // access_token and refresh_token should be retrieved from Clerk when needed
    };
  }

  /**
   * Get user Jira info for the settings page
   * Returns webtrigger_url and project_key (or null if not connected)
   */
  async getUserJiraInfo(clerkUserId: string) {
    try {
      // Get backend user_id from clerk_id
      const user = await this.userService.getUserByClerkId(clerkUserId);
      if (!user) {
        return { webtrigger_url: null, project_key: null };
      }

      // Get Jira info from database
      const jiraInfo = await this.jiraRepository.getJiraInfoUser(user.user_id);
      if (!jiraInfo) {
        return { webtrigger_url: null, project_key: null };
      }

      return {
        webtrigger_url: jiraInfo.webtrigger_url || null,
        project_key: jiraInfo.project_key || null,
      };
    } catch (error) {
      return { webtrigger_url: null, project_key: null };
    }
  }

  /**
   * Get Jira OAuth access token from database (stored during OAuth callback)
   */
  private async getJiraAccessTokenFromDatabase(clerkUserId: string): Promise<string | null> {
    try {
      // Get backend user_id from clerk_id
      const user = await this.userService.getUserByClerkId(clerkUserId);
      if (!user) {
        return null;
      }

      // Get token from User table using dedicated Jira token field
      return await this.jiraRepository.getUserJiraAccessToken(user.user_id);
    } catch (err) {
      console.error('Failed to get Jira access token from database:', err);
      return null;
    }
  }

  /**
   * Get Jira OAuth access token for a project from database
   */
  private async getProjectJiraAccessTokenFromDatabase(projectId: string): Promise<string | null> {
    try {
      return await this.jiraRepository.getProjectJiraAccessToken(projectId);
    } catch (err) {
      console.error('Failed to get project Jira access token from database:', err);
      return null;
    }
  }

  // --------------------------------------------------------
  // PROJECT-LEVEL JIRA CONNECTION METHODS
  // --------------------------------------------------------
  async saveProjectJiraConnection(projectId: string, data: {
    access_token: string;
    refresh_token: string;
    cloud_id: string;
    project_key?: string;
  }) {
    // Construct webtrigger_url from cloud_id
    const webtrigger_url = `https://api.atlassian.com/ex/jira/${data.cloud_id}/rest/api/3`;
    
    // Save connection info to ProjectJira table
    await this.jiraRepository.insertProjectJiraInfo(projectId, {
      webtrigger_url,
      project_key: data.project_key,
      cloud_id: data.cloud_id,
    });

    // Store tokens in Project table using dedicated Jira token fields
    try {
      await this.jiraRepository.updateProjectJiraTokens(
        projectId,
        data.access_token,
        data.refresh_token,
      );
    } catch (err) {
      console.warn('Failed to store Jira tokens in Project table:', err);
      // Continue even if token storage fails - connection info is still saved
    }

      return {
      project_id: projectId,
      cloud_id: data.cloud_id,
      project_key: data.project_key || null,
    };
  }

  async getProjectJiraConnection(projectId: string) {
    // Get Jira info from ProjectJira table
    const jiraInfo = await this.jiraRepository.getProjectJiraInfo(projectId);
    if (!jiraInfo) {
      throw new Error(`Jira connection not found for project: ${projectId}`);
    }

    // Extract cloud_id from webtrigger_url or use stored cloud_id
    const cloud_id = jiraInfo.cloud_id || (jiraInfo.webtrigger_url.match(/\/ex\/jira\/([^\/]+)\//)?.[1] || null);

    if (!cloud_id) {
      throw new Error(`Invalid webtrigger_url format: ${jiraInfo.webtrigger_url}`);
    }

    return {
      cloud_id,
      project_key: jiraInfo.project_key,
      webtrigger_url: jiraInfo.webtrigger_url,
    };
  }

  async checkProjectJiraConnection(projectId: string) {
    try {
      const jiraInfo = await this.jiraRepository.getProjectJiraInfo(projectId);
      const hasTokens = await this.jiraRepository.getProjectJiraAccessToken(projectId);
      
      // Jira is considered connected only if:
      // 1. jiraInfo exists (has webtrigger_url)
      // 2. hasTokens exists (OAuth tokens are stored)
      // 3. project_key is set (Jira project has been selected)
      const hasWebtriggerUrl = !!jiraInfo?.webtrigger_url;
      const hasProjectKey = !!jiraInfo?.project_key && jiraInfo.project_key.trim() !== '';
      
      return {
        connected: !!jiraInfo && !!hasTokens && hasWebtriggerUrl && hasProjectKey,
        project_key: jiraInfo?.project_key || null,
        cloud_id: jiraInfo?.cloud_id || null,
      };
    } catch (error) {
      return {
        connected: false,
        project_key: null,
        cloud_id: null,
      };
    }
  }

  async getProjectsForProject(projectId: string, cloudId?: string) {
    // Get access token from database (stored during OAuth callback)
    const accessToken = await this.getProjectJiraAccessTokenFromDatabase(projectId);
    if (!accessToken) {
      throw new Error('Jira access token not found. Please reconnect your Jira account.');
    }

    // Use provided cloudId or get from existing connection
    let targetCloudId = cloudId;
    if (!targetCloudId) {
      try {
        const creds = await this.getProjectJiraConnection(projectId);
        targetCloudId = creds.cloud_id;
      } catch (err) {
        throw new Error('Jira not connected. Please connect your Jira account first.');
      }
    }

    const response = await fetch(
      `https://api.atlassian.com/ex/jira/${targetCloudId}/rest/api/3/project/search`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    return response.json();
  }

  async updateSelectedProjectForProject(projectId: string, projectKey: string) {
    // Get existing Jira connection
    const jiraInfo = await this.jiraRepository.getProjectJiraInfo(projectId);
    if (!jiraInfo) {
      throw new Error('Jira connection not found. Please connect your Jira account first.');
    }

    // Update project_key
    await this.jiraRepository.insertProjectJiraInfo(projectId, {
      webtrigger_url: jiraInfo.webtrigger_url,
      project_key: projectKey,
      cloud_id: jiraInfo.cloud_id,
    });

    return { success: true, project_key: projectKey };
  }

  async createIssueForProject(projectId: string, body: any) {
    const creds = await this.getProjectJiraConnection(projectId);
    
    // Get access token from database (stored during OAuth callback)
    const accessToken = await this.getProjectJiraAccessTokenFromDatabase(projectId);
    if (!accessToken) {
      throw new Error('Jira access token not found. Please reconnect your Jira account.');
    }

    const response = await fetch(
      `https://api.atlassian.com/ex/jira/${creds.cloud_id}/rest/api/3/issue`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fields: {
            summary: body.summary,
            project: { key: body.projectKey },
            issuetype: { name: 'Task' },
          },
        }),
      },
    );

    return response.json();
  }

  async createIssueFromAlert(projectId: string, alertId: string, body?: { summary?: string; description?: string }) {
    // Check if project has Jira connected
    const jiraStatus = await this.checkProjectJiraConnection(projectId);
    if (!jiraStatus.connected || !jiraStatus.project_key) {
      throw new Error('Jira is not connected to this project. Please connect Jira in project settings.');
    }

    // Get alert details from database
    // Try ProjectAlert first
    let alert: any = null;
    try {
      alert = await this.prisma.projectAlert.findUnique({
        where: { id: alertId },
        include: {
          package: {
            select: {
              name: true,
            },
          },
        },
      });
    } catch (err) {
      // If not found, try ProjectPackageAlert
      try {
        alert = await this.prisma.projectPackageAlert.findUnique({
          where: { id: alertId },
          include: {
            package: {
              select: {
                name: true,
              },
            },
          },
        });
      } catch (err2) {
        throw new Error(`Alert not found: ${alertId}`);
      }
    }

    if (!alert) {
      throw new Error(`Alert not found: ${alertId}`);
    }

    // Build summary and description
    const alertType = alert.alert_type || alert.alertType;
    const packageName = alert.package?.name || 'Project';
    const severity = alert.severity || 'medium';
    
    const summary = body?.summary || `${alertType.charAt(0).toUpperCase() + alertType.slice(1)} Alert: ${packageName}`;
    
    let description = body?.description || '';
    if (!description) {
      description = `**Alert Type:** ${alertType}\n`;
      description += `**Package:** ${packageName}\n`;
      description += `**Severity:** ${severity}\n`;
      description += `**Detected:** ${new Date(alert.detected_at || alert.created_at).toLocaleString()}\n\n`;
      
      if (alert.message) {
        description += `**Message:** ${alert.message}\n\n`;
      }
      
      if (alert.vulnerability_details) {
        const vulnDetails = alert.vulnerability_details as any;
        description += `**Vulnerability Details:**\n`;
        description += `- ID: ${alert.vulnerability_id || 'N/A'}\n`;
        if (vulnDetails.summary) {
          description += `- Summary: ${vulnDetails.summary}\n`;
        }
      }
      
      if (alert.anomaly_score) {
        description += `**Anomaly Score:** ${alert.anomaly_score}\n`;
        if (alert.commit_sha) {
          description += `**Commit:** ${alert.commit_sha}\n`;
        }
      }
      
      if (alert.details) {
        const details = alert.details as any;
        if (details.score !== undefined) {
          description += `**Score:** ${details.score}\n`;
        }
        if (details.new_score !== undefined) {
          description += `**New Score:** ${details.new_score}\n`;
        }
      }
    }

    // Create Jira issue
    const creds = await this.getProjectJiraConnection(projectId);
    const accessToken = await this.getProjectJiraAccessTokenFromDatabase(projectId);
    if (!accessToken) {
      throw new Error('Jira access token not found. Please reconnect your Jira account.');
    }

    const response = await fetch(
      `https://api.atlassian.com/ex/jira/${creds.cloud_id}/rest/api/3/issue`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fields: {
            summary: summary,
            description: {
              type: 'doc',
              version: 1,
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: description,
                    },
                  ],
                },
              ],
            },
            project: { key: jiraStatus.project_key },
            issuetype: { name: 'Task' },
            priority: {
              name: severity === 'critical' ? 'Highest' : severity === 'high' ? 'High' : severity === 'medium' ? 'Medium' : 'Low',
            },
          },
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create Jira issue: ${errorText}`);
    }

    return response.json();
  }
}
