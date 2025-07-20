import { IsString, IsNotEmpty, IsDefined } from "class-validator";

export class SlackOauthConnect {
  @IsString()
  @IsNotEmpty()
  @IsDefined()
  code: string;

  @IsString()
  @IsNotEmpty()
  @IsDefined()
  state: string;
}

export class SlackInsert {
  @IsString()
  @IsNotEmpty()
  @IsDefined()
  userId: string;

  @IsString()
  @IsNotEmpty()
  @IsDefined()
  token: string;

  @IsString()
  channel?: string;
}

export class SlackOauthSend {
  @IsString()
  @IsString()
  @IsNotEmpty()
  code: string;

  client_id: string;

  client_secret: string;

  @IsString()
  @IsString()
  @IsNotEmpty()
  redirect_uri: string;

}