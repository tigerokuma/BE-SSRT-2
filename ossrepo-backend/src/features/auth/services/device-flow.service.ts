import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { DeviceCodeResponseDto, TokenResponseDto } from '../dto/auth.dto';

@Injectable()
export class DeviceFlowService {
  private readonly githubApiUrl = 'https://github.com';

  constructor(private readonly configService: ConfigService) {}

  async initiateDeviceFlow(
    clientId: string,
    scope?: string,
  ): Promise<DeviceCodeResponseDto> {
    try {
      // GitHub expects form data, not JSON
      const formData = new URLSearchParams();
      formData.append('client_id', clientId);
      if (scope) {
        formData.append('scope', scope);
      }

      const response = await axios.post(
        `${this.githubApiUrl}/login/device/code`,
        formData,
        {
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );

      return response.data;
    } catch (error) {
      console.error(
        'Device flow initiation error:',
        error.response?.data || error.message,
      );
      throw new HttpException(
        'Failed to initiate device flow',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  async pollForToken(
    clientId: string,
    deviceCode: string,
  ): Promise<TokenResponseDto> {
    try {
      // GitHub expects form data, not JSON
      const formData = new URLSearchParams();
      formData.append('client_id', clientId);
      formData.append('device_code', deviceCode);
      formData.append(
        'grant_type',
        'urn:ietf:params:oauth:grant-type:device_code',
      );

      const response = await axios.post(
        `${this.githubApiUrl}/login/oauth/access_token`,
        formData,
        {
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );

      if (response.data.error) {
        throw new HttpException(
          this.getErrorMessage(response.data.error),
          this.getErrorStatus(response.data.error),
        );
      }

      return response.data;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      console.error(
        'Token polling error:',
        error.response?.data || error.message,
      );
      throw new HttpException(
        'Failed to poll for token',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  private getErrorMessage(error: string): string {
    const errorMessages = {
      authorization_pending:
        'Authorization is pending. Please complete the verification.',
      slow_down: 'Polling too frequently. Please wait longer between requests.',
      expired_token: 'The device code has expired. Please restart the flow.',
      access_denied: 'The user denied the authorization request.',
      incorrect_client_credentials: 'Invalid client credentials.',
      incorrect_device_code: 'Invalid device code.',
    };

    return errorMessages[error] || 'An unexpected error occurred';
  }

  private getErrorStatus(error: string): HttpStatus {
    const errorStatuses = {
      authorization_pending: HttpStatus.ACCEPTED,
      slow_down: HttpStatus.TOO_MANY_REQUESTS,
      expired_token: HttpStatus.GONE,
      access_denied: HttpStatus.FORBIDDEN,
      incorrect_client_credentials: HttpStatus.UNAUTHORIZED,
      incorrect_device_code: HttpStatus.BAD_REQUEST,
    };

    return errorStatuses[error] || HttpStatus.INTERNAL_SERVER_ERROR;
  }
}
