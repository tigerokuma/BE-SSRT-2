// src/modules/user/user.repository.ts
import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../common/prisma/prisma.service'
import { UpdateUserDto } from './user.dto'

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  // upsert by clerk_id
  async upsertByClerkId(data: {
    clerk_id: string
    email: string
    name: string | null
    last_login?: Date
  }) {
    const { clerk_id, email, name, last_login } = data
    return this.prisma.user.upsert({
      where: { clerk_id },
      create: {
        clerk_id,
        email,
        name: name || undefined,
        last_login,
      },
      update: {
        email,
        name,
        last_login,
      },
    })
  }

  async updateUser(user_id: string, dto: UpdateUserDto) {
    return this.prisma.user.update({
      where: { user_id },
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
      where: { user_id },
      data: {
        github_id: fields.github_id ?? undefined,
        github_username: fields.github_username ?? undefined,
        access_token: fields.access_token ?? undefined,
        refresh_token: fields.refresh_token ?? undefined,
      },
    })
  }

  async touchLastLogin(clerk_id: string, when: Date) {
    return this.prisma.user.update({
      where: { clerk_id },
      data: { last_login: when },
    })
  }

  async getUserById(user_id: string) {
    return this.prisma.user.findUnique({ where: { user_id } })
  }

  async getUserByClerkId(clerk_id: string) {
    return this.prisma.user.findUnique({ where: { clerk_id } })
  }

  async getUserByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } })
  }

  async getAllUsers() {
    return this.prisma.user.findMany()
  }
}
