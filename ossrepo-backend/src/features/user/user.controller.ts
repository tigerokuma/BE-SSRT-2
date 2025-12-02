// src/modules/user/user.controller.ts
import { Controller, Post, Get, Body, Param, Patch } from '@nestjs/common'
import { UserService } from './user.service'
import {
  CreateOrUpdateFromClerkDto,
  UpdateUserDto,
  IngestClerkGithubDto,
  IngestClerkJiraDto,
} from './user.dto'

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  // Called by FE after successful sign-in
  @Post('sync-from-clerk')
  async syncFromClerk(@Body() body: CreateOrUpdateFromClerkDto) {
    const user = await this.userService.createOrUpdateFromClerk(body)
    return user
  }

  // Optionally let FE signal a login touch (not required if you do it in syncFromClerk)
  @Post('touch-login/:clerkId')
  async touchLogin(@Param('clerkId') clerkId: string) {
    return this.userService.touchLastLogin(clerkId)
  }

  // Save GitHub tokens/id/username after user connected GitHub in Clerk
  @Post(':id/ingest-clerk-github')
  async ingestGithub(
    @Param('id') user_id: string,
    @Body() body: IngestClerkGithubDto
  ) {
    return this.userService.ingestGithubFromClerk(user_id, body)
  }

  // Save Jira tokens/id/username after user connected Jira in Clerk
  @Post(':id/ingest-clerk-jira')
  async ingestJira(
    @Param('id') user_id: string,
    @Body() body: IngestClerkJiraDto
  ) {
    return this.userService.ingestJiraFromClerk(user_id, body)
  }

  // Ingest GitHub by clerk_id (used by SSO callback)
  @Post('ingest-clerk-github-by-clerk-id')
  async ingestGithubByClerkId(@Body() body: IngestClerkGithubDto) {
    const user = await this.userService.getUserByClerkId(body.clerk_id);
    if (!user) {
      throw new Error(`User not found for clerk_id: ${body.clerk_id}`);
    }
    return this.userService.ingestGithubFromClerk(user.user_id, body);
  }

  // Ingest Jira by clerk_id (used by SSO callback)
  @Post('ingest-clerk-jira-by-clerk-id')
  async ingestJiraByClerkId(@Body() body: IngestClerkJiraDto) {
    const user = await this.userService.getUserByClerkId(body.clerk_id);
    if (!user) {
      throw new Error(`User not found for clerk_id: ${body.clerk_id}`);
    }
    return this.userService.ingestJiraFromClerk(user.user_id, body);
  }

  // --- existing routes (optional to keep) ---
  @Get(':id')
  async getUserById(@Param('id') id: string) {
    return this.userService.getUserById(id)
  }

  @Get('by-clerk/:clerkId')
  async getUserByClerkId(@Param('clerkId') clerkId: string) {
    return this.userService.getUserByClerkId(clerkId)
  }

  @Get()
  async getAllUsers() {
    return this.userService.getAllUsers()
  }

  @Patch(':id')
  async updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.userService.updateUser(id, dto)
  }
}
