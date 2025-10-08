import { Controller, Post, Get, Body, Param } from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserRequest } from './user.dto';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post()
  async createUser(@Body() body: CreateUserRequest) {
    return this.userService.createUser(body);
  }

  @Get(':id')
  async getUserById(@Param('id') id: string) {
    return this.userService.getUserById(id);
  }

  @Get()
  async getAllUsers() {
    return this.userService.getAllUsers();
  }

  @Get('test/github')
  async getTestUserWithGitHub() {
    return this.userService.getUserByEmail('test@example.com');
  }
}
