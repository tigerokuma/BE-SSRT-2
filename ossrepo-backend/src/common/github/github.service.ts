import {Injectable} from '@nestjs/common';
import type {Octokit as OctokitType} from '@octokit/rest'; // type-only
import {PrismaService} from '../prisma/prisma.service';

@Injectable()
export class GitHubService {
    // keep a fallback instance if you want, but construct it lazily
    private fallbackOctokit?: OctokitType;

    constructor(private readonly prisma: PrismaService) {
    }

    private async createOctokit(auth?: string): Promise<OctokitType> {
        const dynImport = new Function('m', 'return import(m)');
        const {Octokit} = await dynImport('@octokit/rest') as typeof import('@octokit/rest');
        return new Octokit({auth});
    }

    async getAuthenticatedOctokit(userId?: string): Promise<OctokitType> {   // explicit return type
        try {
            let token = process.env.GITHUB_TOKEN ?? '';
            
            if (userId) {
                const user = await this.prisma.user.findUnique({
                    where: {user_id: userId},
                    select: {access_token: true},
                });
                token = user?.access_token ?? process.env.GITHUB_TOKEN ?? '';
            }

            return this.createOctokit(token);
        } catch (err) {
            console.error('Error getting GitHub token:', err);
            if (!this.fallbackOctokit) {
                this.fallbackOctokit = await this.createOctokit(process.env.GITHUB_TOKEN);
            }
            return this.fallbackOctokit;
        }
    }

    async getPackageJson(owner: string, repo: string, userId?: string): Promise<any | null> {
        try {
            const octokit = await this.getAuthenticatedOctokit(userId);

            // First verify the repository exists by getting repo info
            try {
                await octokit.repos.get({ owner, repo });
            } catch (repoError: any) {
                // If repo doesn't exist, throw a clear error
                if (repoError.status === 404) {
                    throw new Error(`Repository not found: ${owner}/${repo}. Please check if the repository exists and is accessible.`);
                } else if (repoError.status === 403) {
                    throw new Error(`Access denied to repository: ${owner}/${repo}. Please check if the repository is public or if your GitHub token has the necessary permissions.`);
                }
                // For other repo errors, still try to get package.json
            }

            // Now try to get package.json
            const response = await octokit.repos.getContent({
                owner,
                repo,
                path: 'package.json',
            });

            if ('content' in response.data) {
                const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
                return JSON.parse(content);
            }

            return null; // package.json not found or not a file
        } catch (error: any) {
            // If it's a repository access error, re-throw it
            if (error.message?.includes('Repository not found') || error.message?.includes('Access denied')) {
                throw error;
            }

            // For 404 on package.json specifically, return null (file doesn't exist)
            if (error.status === 404) {
                console.log(`package.json not found in ${owner}/${repo} - repository may be empty or not a Node.js project`);
                return null;
            }

            // For other errors, log and return null to allow project creation to continue
            console.log(`Failed to fetch package.json for ${owner}/${repo}: ${error.message || error}. Continuing without dependencies.`);
            return null;
        }
    }

    async extractDependencies(repoUrl: string, userId?: string): Promise<{ name: string; version: string }[]> {
        try {
            // Extract owner and repo from GitHub URL (handle various formats)
            const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?(?:\/.*)?$/);
            if (!match) {
                throw new Error(`Invalid GitHub repository URL: ${repoUrl}. Expected format: https://github.com/owner/repo`);
            }

            const [, owner, repo] = match;

            const packageJson = await this.getPackageJson(owner, repo, userId);

            // If package.json doesn't exist, return empty array (empty repo or non-Node.js project)
            if (!packageJson) {
                console.log(`No package.json found in ${owner}/${repo} - returning empty dependencies`);
                return [];
            }

            const dependencies = [];

            // Helper function to clean and validate version
            const cleanVersion = (version: string): string | null => {
                if (!version || typeof version !== 'string') return null;

                // Remove common prefixes and clean up
                let cleaned = version.trim();

                // Skip file paths and URLs
                if (cleaned.startsWith('./') || cleaned.startsWith('../') || cleaned.startsWith('file:') || cleaned.startsWith('http')) {
                    return null;
                }

                // Skip npm: prefixes
                if (cleaned.startsWith('npm:')) {
                    cleaned = cleaned.replace('npm:', '');
                }

                // Extract version from range notation (^1.2.3 -> 1.2.3)
                const rangeMatch = cleaned.match(/^[\^~]?(\d+\.\d+\.\d+)/);
                if (rangeMatch) {
                    return rangeMatch[1];
                }

                // Extract version from other patterns
                const versionMatch = cleaned.match(/(\d+\.\d+\.\d+)/);
                if (versionMatch) {
                    return versionMatch[1];
                }

                // If it looks like a valid semver, return as is
                if (/^\d+\.\d+\.\d+/.test(cleaned)) {
                    return cleaned;
                }

                return null; // Skip invalid versions
            };

            // Extract production dependencies only (exclude devDependencies)
            if (packageJson.dependencies) {
                for (const [name, version] of Object.entries(packageJson.dependencies)) {
                    const cleanedVersion = cleanVersion(version as string);
                    if (cleanedVersion) {
                        dependencies.push({name, version: cleanedVersion});
                    }
                }
            }

            return dependencies;
        } catch (error) {
            console.error('Error extracting dependencies:', error);
            // If it's a repository access error, re-throw it
            // Otherwise, return empty array to allow project creation to continue
            if (error.message?.includes('Repository not found') || error.message?.includes('Access denied')) {
                throw error;
            }
            console.log(`Error extracting dependencies, returning empty array: ${error.message}`);
            return [];
        }
    }
}
