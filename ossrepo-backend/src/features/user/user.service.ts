// src/modules/user/user.service.ts
import {Injectable} from '@nestjs/common'
import {createClerkClient} from '@clerk/backend'
import type {OAuthProvider} from '@clerk/types';
import {UserRepository} from './user.repository'
import {
    CreateOrUpdateFromClerkDto,
    UpdateUserDto,
    IngestClerkGithubDto,
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
            return this.userRepository.getUserByClerkId(user_id);
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
        // (refresh_token is usually not present for GitHub; store null/undefined if you don’t have one)
        const updated = await this.userRepository.setGithubFieldsByClerkId(user_id, {
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
