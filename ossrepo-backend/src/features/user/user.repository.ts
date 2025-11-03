// src/modules/user/user.repository.ts
import {Injectable} from '@nestjs/common'
import {PrismaService} from '../../common/prisma/prisma.service'
import {UpdateUserDto} from './user.dto'

@Injectable()
export class UserRepository {
    constructor(private readonly prisma: PrismaService) {
    }

    // upsert by clerk_id
    async upsertByClerkId(data: {
        clerk_id: string
        email: string
        name: string | null
        last_login?: Date
    }) {
        const {clerk_id, email, name, last_login} = data
        
        // First, try to find existing user by clerk_id
        const existingByClerkId = await this.prisma.user.findUnique({
            where: { clerk_id }
        })
        
        if (existingByClerkId) {
            // Update existing user
            return this.prisma.user.update({
                where: { clerk_id },
                data: {
                    email,
                    name,
                    last_login,
                }
            })
        }
        
        // Check if user exists with same email but different clerk_id
        const existingByEmail = await this.prisma.user.findUnique({
            where: { email }
        })
        
        if (existingByEmail) {
            // Update the existing user to use the new clerk_id
            return this.prisma.user.update({
                where: { email },
                data: {
                    clerk_id,
                    name,
                    last_login,
                }
            })
        }
        
        // Create new user
        return this.prisma.user.create({
            data: {
                clerk_id,
                email,
                name: name || undefined,
                last_login,
            }
        })
    }

    async updateUser(user_id: string, dto: UpdateUserDto) {
        return this.prisma.user.update({
            where: {user_id},
            data: {
                email: dto.email,
                name: dto.name,
            },
        })
    }

    async setGithubFields(
        user_id: string,
        fields: {
            github_id: string | null
            github_username: string | null
            access_token: string | null
            refresh_token?: string | null
        }
    ) {
        return this.prisma.user.update({
            where: {user_id},
            data: {
                github_id: fields.github_id ?? undefined,
                github_username: fields.github_username ?? undefined,
                access_token: fields.access_token ?? undefined,
                refresh_token: fields.refresh_token ?? undefined,
            },
        })
    }

    async setGithubFieldsByClerkId(clerkId: string, data: {
        github_id?: string | null
        github_username?: string | null
        access_token?: string | null
        refresh_token?: string | null
    }) {
        return this.prisma.user.update({
            where: {clerk_id: clerkId},
            data: {
                github_id: data.github_id ?? null,
                github_username: data.github_username ?? null,
                access_token: data.access_token ?? null,
                refresh_token: data.refresh_token ?? null,
            },
        });
    }

    async touchLastLogin(clerk_id: string, when: Date) {
        return this.prisma.user.update({
            where: {clerk_id},
            data: {last_login: when},
        })
    }

    async getUserById(user_id: string) {
        return this.prisma.user.findUnique({where: {user_id}})
    }

    async getUserByClerkId(clerk_id: string) {
        return this.prisma.user.findUnique({where: {clerk_id}})
    }

    async getUserByEmail(email: string) {
        return this.prisma.user.findUnique({where: {email}})
    }

    async getAllUsers() {
        return this.prisma.user.findMany()
    }
}
