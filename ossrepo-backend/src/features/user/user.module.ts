import { Module } from '@nestjs/common';
import { UserRepository } from './user.repository';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { PrismaService } from '../../common/prisma/prisma.service';

@Module({
  providers: [UserRepository, UserService, PrismaService],
  controllers: [UserController],
  exports: [UserService],
})
export class UserModule {} 