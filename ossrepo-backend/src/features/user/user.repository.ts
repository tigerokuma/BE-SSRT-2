import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateUserRequest } from './user.dto';

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createUser(data: CreateUserRequest) {
    return this.prisma.user.create({ data });
  }

  async getUserById(user_id: string) {
    return this.prisma.user.findUnique({ where: { user_id } });
  }

  async getUserByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async getAllUsers() {
    return this.prisma.user.findMany();
  }
} 