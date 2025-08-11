import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthUserDto } from './dto/auth.dto';
import axios from 'axios';

interface GithubUser {
  github_id: string;
  github_username: string;
  email: string;
  name?: string;
  access_token: string;
  refresh_token?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async validateGithubToken(accessToken: string) {
    try {
      // Get user info from GitHub
      const userResponse = await axios.get('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      // Get user's email from GitHub
      const emailsResponse = await axios.get('https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      });

      const primaryEmail = emailsResponse.data.find(email => email.primary)?.email;
      if (!primaryEmail) {
        throw new UnauthorizedException('No primary email found');
      }

      const githubUser: GithubUser = {
        github_id: userResponse.data.id.toString(),
        github_username: userResponse.data.login,
        email: primaryEmail,
        name: userResponse.data.name,
        access_token: accessToken,
      };

      return this.validateGithubUser(githubUser);
    } catch (error) {
      console.error('GitHub API error:', error.response?.data || error.message);
      throw new UnauthorizedException('Failed to validate GitHub token');
    }
  }

  async validateGithubUser(githubUser: GithubUser) {
    // Find existing user by GitHub ID or email
    let user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { github_id: githubUser.github_id },
          { email: githubUser.email }
        ]
      }
    });

    if (!user) {
      // Create new user if doesn't exist
      user = await this.prisma.user.create({
        data: {
          email: githubUser.email,
          name: githubUser.name,
          github_id: githubUser.github_id,
          github_username: githubUser.github_username,
          access_token: githubUser.access_token,
          refresh_token: githubUser.refresh_token,
          email_confirmed: true, // Auto-confirm email for GitHub users
          last_login: new Date(),
        }
      });
    } else {
      // Update existing user with latest GitHub info
      user = await this.prisma.user.update({
        where: { user_id: user.user_id },
        data: {
          github_id: githubUser.github_id,
          github_username: githubUser.github_username,
          access_token: githubUser.access_token,
          refresh_token: githubUser.refresh_token,
          last_login: new Date(),
        }
      });
    }

    return this.createAuthResponse(user);
  }

  async validateUserById(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { user_id: userId }
    });

    if (!user) {
      throw new UnauthorizedException();
    }

    return user;
  }

  private createAuthResponse(user: any) {
    const payload = { sub: user.user_id, email: user.email };
    
    const userDto: AuthUserDto = {
      user_id: user.user_id,
      email: user.email,
      name: user.name,
      github_username: user.github_username,
    };

    return {
      user: userDto,
      access_token: this.jwtService.sign(payload),
    };
  }
}