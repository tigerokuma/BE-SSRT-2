import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-github2';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';

@Injectable()
export class GithubStrategy extends PassportStrategy(Strategy, 'github') {
  constructor(
    private configService: ConfigService,
    private authService: AuthService,
  ) {
    const clientID = configService.get<string>('GITHUB_CLIENT_ID');
    const clientSecret = configService.get<string>('GITHUB_CLIENT_SECRET');
    const callbackURL = configService.get<string>('GITHUB_CALLBACK_URL');

    if (!clientID || !clientSecret) {
      throw new Error(
        'GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET must be configured',
      );
    }

    super({
      clientID,
      clientSecret,
      callbackURL: callbackURL || 'http://localhost:3000/auth/github/callback',
      scope: ['user:email', 'repo', 'admin:repo_hook'],
    });
  }

  async validate(accessToken: string, refreshToken: string, profile: any) {
    const { id, username, emails, displayName } = profile;

    const user = await this.authService.validateGithubUser({
      github_id: id,
      github_username: username,
      email: emails[0].value,
      name: displayName,
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    return user;
  }
}
