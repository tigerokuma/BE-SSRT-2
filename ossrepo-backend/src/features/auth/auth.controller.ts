import {
  Controller,
  Get,
  Post,
  UseGuards,
  Req,
  Res,
  Body,
  HttpCode,
  Query,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { DeviceFlowService } from './services/device-flow.service';
import { GithubAuthGuard } from './guards/github-auth.guard';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import {
  DeviceCodeRequestDto,
  DeviceCodeResponseDto,
  DeviceTokenRequestDto,
  TokenResponseDto,
  LoginResponseDto,
} from './dto/auth.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly deviceFlowService: DeviceFlowService,
    private readonly configService: ConfigService,
  ) {}

  @Post('device/code')
  @HttpCode(200)
  @ApiOperation({ summary: 'Initialize device flow authentication' })
  @ApiResponse({ status: 200, type: DeviceCodeResponseDto })
  @ApiBody({ type: DeviceCodeRequestDto })
  async initiateDeviceFlow(
    @Body() request: DeviceCodeRequestDto,
  ): Promise<DeviceCodeResponseDto> {
    return this.deviceFlowService.initiateDeviceFlow(
      request.client_id,
      request.scope,
    );
  }

  @Post('device/token')
  @HttpCode(200)
  @ApiOperation({ summary: 'Poll for device token' })
  @ApiResponse({ status: 200, type: TokenResponseDto })
  @ApiResponse({ status: 202, description: 'Authorization pending' })
  @ApiBody({ type: DeviceTokenRequestDto })
  async pollDeviceToken(@Body() request: DeviceTokenRequestDto) {
    const tokenResponse = await this.deviceFlowService.pollForToken(
      request.client_id,
      request.device_code,
    );

    // If we got a token, get the user info
    if (tokenResponse.access_token) {
      return this.authService.validateGithubToken(tokenResponse.access_token);
    }

    return tokenResponse;
  }

  // Existing web-flow endpoints
  @Get('github')
  @UseGuards(GithubAuthGuard)
  @ApiOperation({ summary: 'Initiate GitHub OAuth login (Web flow)' })
  async githubAuth() {
    // Guard redirects to GitHub
  }

  @Get('github/callback')
  @UseGuards(GithubAuthGuard)
  @ApiOperation({ summary: 'GitHub OAuth callback (Web flow)' })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  async githubAuthCallback(@Req() req: any, @Res() res: Response) {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL');
    const user = req.user;

    // Redirect to frontend with token
    res.redirect(`${frontendUrl}/auth/callback?token=${user.access_token}`);
  }
}
