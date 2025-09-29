import { IsString, IsOptional, IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AuthUserDto {
  @ApiProperty()
  @IsString()
  user_id: string;

  @ApiProperty()
  @IsString()
  email: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  github_username?: string;
}

export class DeviceCodeRequestDto {
  @ApiProperty()
  @IsString()
  client_id: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  scope?: string;
}

export class DeviceCodeResponseDto {
  @ApiProperty()
  @IsString()
  device_code: string;

  @ApiProperty()
  @IsString()
  user_code: string;

  @ApiProperty()
  @IsString()
  verification_uri: string;

  @ApiProperty()
  @IsNumber()
  expires_in: number;

  @ApiProperty()
  @IsNumber()
  interval: number;
}

export class DeviceTokenRequestDto {
  @ApiProperty()
  @IsString()
  client_id: string;

  @ApiProperty()
  @IsString()
  device_code: string;

  @ApiProperty()
  @IsString()
  grant_type: string = 'urn:ietf:params:oauth:grant-type:device_code';
}

export class TokenResponseDto {
  @ApiProperty()
  @IsString()
  access_token: string;

  @ApiProperty()
  @IsString()
  token_type: string;

  @ApiProperty()
  @IsString()
  scope: string;
}

export class LoginResponseDto {
  @ApiProperty({ type: AuthUserDto })
  user: AuthUserDto;

  @ApiProperty()
  access_token: string;
}
