// src/modules/user/user.service.ts
import {Injectable} from '@nestjs/common'
import {createClerkClient} from '@clerk/backend'
import type {OAuthProvider} from '@clerk/types';
import {UserRepository} from './user.repository'
import {JiraRepository} from '../alert/repositories/jira.repository'
import {
    CreateOrUpdateFromClerkDto,
    UpdateUserDto,
    IngestClerkGithubDto,
    IngestClerkJiraDto,
} from './user.dto'

const clerk = createClerkClient({
    // make sure CLERK_SECRET_KEY is present in your backend .env
    secretKey: process.env.CLERK_SECRET_KEY!,
})

@Injectable()
export class UserService {
    constructor(private readonly userRepository: UserRepository) {
    }

    /**
     * Upsert a local user from Clerk data on first sign-in (or any sign-in).
     * - Creates if not found
     * - Updates name/email if changed
     * - Updates last_login
     */
    async createOrUpdateFromClerk(dto: CreateOrUpdateFromClerkDto) {
        // pull the latest Clerk info to be source-of-truth
        const cUser = await clerk.users.getUser(dto.clerk_id)

        const email =
            dto.email ||
            cUser?.primaryEmailAddress?.emailAddress ||
            cUser?.emailAddresses?.[0]?.emailAddress ||
            ''

        const name =
            dto.name ||
            cUser?.fullName ||
            [cUser?.firstName, cUser?.lastName].filter(Boolean).join(' ') ||
            null

        return this.userRepository.upsertByClerkId({
            clerk_id: dto.clerk_id,
            email,
            name,
            last_login: new Date(),
        })
    }

    /**
     * Update profile fields the user can edit.
     */
    async updateUser(user_id: string, dto: UpdateUserDto) {
        return this.userRepository.updateUser(user_id, dto)
    }

    /**
     * After the user connects GitHub via Clerk, pull their GitHub info + token
     * from Clerk and save it into our local DB.
     * This expects Clerk OAuth Access Tokens to be enabled for GitHub.
     */
    // user.service.ts
    async ingestGithubFromClerk(user_id: string, body: IngestClerkGithubDto) {
        const {clerk_id} = body;

        if (!clerk_id) {
            throw new Error('clerk_id is required to ingest GitHub data');
        }

        // 1) Get the Clerk user (validates the id and gives us external accounts)
        let cUser;
        try {
            cUser = await clerk.users.getUser(clerk_id);
        } catch (e) {
            throw new Error(`Unable to fetch Clerk user for id ${clerk_id}`);
        }

        // 2) Locate the GitHub external account on the Clerk user
        const ghEA = cUser.externalAccounts?.find(
            (ea: any) => ea?.provider === 'oauth_github' || ea?.provider === 'github'
        );

        // Extract provider user id & username (field names vary across Clerk versions)
        const github_id: string | null =
            (ghEA && (ghEA.providerUserId ?? ghEA.externalId)) ?? null;

        const github_username: string | null =
            (ghEA && (ghEA.username ?? ghEA.login ?? ghEA.screenName)) ?? null;

        if (!github_id) {
            // No GH account linked; return the current local user record unchanged
            return this.userRepository.getUserByClerkId(clerk_id);
        }

        // 3) Try to fetch the stored OAuth access token from Clerk for GitHub
        //    Requires: Clerk Dashboard → Connections → GitHub → "Store connected accounts’ access tokens" = ON
        //    If the user connected without `repo` scope, GitHub will not grant private repo access.
        let accessToken: string | null = null;
        let scopes: string[] | undefined;
        try {
            const tokensRes = await clerk.users.getUserOauthAccessToken(
                clerk_id,
                'github' as any
            );

            const data = tokensRes?.data ?? [];

            if (!data.length) {
                // This is the most common cause of “connected but no token”
                // - Token storage is OFF in Clerk dashboard, or
                // - User linked without required scopes (e.g., no `repo`)
                throw new Error(
                    'No GitHub OAuth token found in Clerk. Ensure token storage is ON and the user has granted required scopes.'
                );
            }

            const first = data[0] as any;
            accessToken = first?.token ?? null;
            scopes = first?.scopes;
        } catch (err: any) {
            // Surface a helpful message but still save id/username so you can show “Connected” with a warning
            console.warn('getUserOauthAccessToken failed (no stored token or missing scopes)', {
                clerk_id,
                message: err?.message ?? String(err),
            });
        }

        // 4) Persist to your local DB
        // (refresh_token is usually not present for GitHub; store null/undefined if you don't have one)
        const updated = await this.userRepository.setGithubFieldsByClerkId(clerk_id, {
            github_id,
            github_username,
            access_token: accessToken ?? null,
            refresh_token: null,
        });

        // 5) Optional: If no token, throw or return with a flag so the caller can prompt re-consent
        if (!accessToken) {
            // You can choose to throw here to force the client to show a re-consent flow:
            // throw new Error('GitHub linked but no token stored. Ask the user to reconnect with repo scope.');
            // Or just return the updated user; your client can check for a missing token and prompt re-connect.
        }

        return updated;
    }

    /**
     * After the user connects Jira via Clerk, pull their Jira info + token
     * from Clerk and save it into our local DB.
     * This expects Clerk OAuth Access Tokens to be enabled for Jira.
     */
    async ingestJiraFromClerk(user_id: string, body: IngestClerkJiraDto) {
        const {clerk_id} = body;

        if (!clerk_id) {
            throw new Error('clerk_id is required to ingest Jira data');
        }

        // 1) Get the Clerk user (validates the id and gives us external accounts)
        let cUser;
        try {
            cUser = await clerk.users.getUser(clerk_id);
        } catch (e) {
            throw new Error(`Unable to fetch Clerk user for id ${clerk_id}`);
        }

        // 2) Locate the Jira external account on the Clerk user
        const jiraEA = cUser.externalAccounts?.find(
            (ea: any) => {
                const p = String(ea.provider).toLowerCase();
                return p === 'jira' || p === 'oauth_jira' || p === 'atlassian';
            }
        );

        // Extract provider user id & username
        const jira_account_id: string | null =
            (jiraEA && (jiraEA.providerUserId ?? jiraEA.externalId)) ?? null;

        const jira_username: string | null =
            (jiraEA && (jiraEA.username ?? jiraEA.login ?? jiraEA.screenName)) ?? null;

        if (!jira_account_id) {
            // No Jira account linked; return the current local user record unchanged
            return this.userRepository.getUserByClerkId(clerk_id);
        }

        // 3) Try to fetch the stored OAuth access token from Clerk for Jira
        //    Requires: Clerk Dashboard → Connections → Jira → "Store connected accounts' access tokens" = ON
        let accessToken: string | null = null;
        let refreshToken: string | null = null;
        let scopes: string[] | undefined;
        try {
            // Try different provider names
            const providerNames = ['jira', 'oauth_jira', 'atlassian'];
            let tokensRes = null;
            
            for (const provider of providerNames) {
                try {
                    tokensRes = await clerk.users.getUserOauthAccessToken(
                        clerk_id,
                        provider as any
                    );
                    if (tokensRes?.data?.length) break;
                } catch (e) {
                    // Try next provider
                    continue;
                }
            }

            const data = tokensRes?.data ?? [];

            if (!data.length) {
                throw new Error(
                    'No Jira OAuth token found in Clerk. Ensure token storage is ON and the user has granted required scopes.'
                );
            }

            const first = data[0] as any;
            accessToken = first?.token ?? null;
            refreshToken = first?.refresh_token ?? null;
            scopes = first?.scopes;
        } catch (err: any) {
            console.warn('getUserOauthAccessToken failed (no stored token or missing scopes)', {
                clerk_id,
                message: err?.message ?? String(err),
            });
        }

        // 4) Get Jira cloud ID and projects using the access token
        let cloud_id: string | null = null;
        let project_key: string | null = null;
        
        if (accessToken) {
            try {
                // Get accessible resources (Jira sites)
                const sitesRes = await fetch(
                    'https://api.atlassian.com/oauth/token/accessible-resources',
                    {
                        headers: { Authorization: `Bearer ${accessToken}` },
                    },
                );
                
                if (sitesRes.ok) {
                    const sites = await sitesRes.json();
                    if (sites && sites.length > 0) {
                        cloud_id = sites[0].id;
                        
                        // Get first project as default
                        const projectsRes = await fetch(
                            `https://api.atlassian.com/ex/jira/${cloud_id}/rest/api/3/project/search?maxResults=1`,
                            {
                                headers: {
                                    Authorization: `Bearer ${accessToken}`,
                                },
                            },
                        );
                        
                        if (projectsRes.ok) {
                            const projects = await projectsRes.json();
                            if (projects?.values && projects.values.length > 0) {
                                project_key = projects.values[0].key;
                            }
                        }
                    }
                }
            } catch (err: any) {
                console.warn('Failed to fetch Jira cloud ID or projects', {
                    clerk_id,
                    message: err?.message ?? String(err),
                });
            }
        }

        // 5) Get backend user_id from clerk_id
        const backendUser = await this.userRepository.getUserByClerkId(clerk_id);
        if (!backendUser) {
            throw new Error(`Backend user not found for clerk_id: ${clerk_id}`);
        }

        // 6) Store Jira connection info in the database
        // Construct webtrigger_url from cloud_id (for backward compatibility with existing schema)
        const webtrigger_url = cloud_id 
            ? `https://api.atlassian.com/ex/jira/${cloud_id}/rest/api/3`
            : `https://api.atlassian.com/oauth/token/accessible-resources`;

        // Note: We're storing project_key and webtrigger_url (constructed from cloud_id)
        // OAuth tokens are stored in Clerk and can be retrieved when needed
        // The Jira connection will be saved via a separate service call if needed
        // For now, we return the data and the caller can handle persistence
        
        return {
            user_id: backendUser.user_id,
            jira_account_id,
            jira_username,
            cloud_id,
            project_key,
            has_token: !!accessToken,
        };
    }

    async getUserById(user_id: string) {
        return this.userRepository.getUserById(user_id)
    }

    async getUserByClerkId(clerk_id: string) {
        return this.userRepository.getUserByClerkId(clerk_id)
    }

    async getAllUsers() {
        return this.userRepository.getAllUsers()
    }

    async touchLastLogin(clerk_id: string) {
        return this.userRepository.touchLastLogin(clerk_id, new Date())
    }
}
