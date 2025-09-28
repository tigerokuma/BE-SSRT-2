import { IsString, IsNotEmpty, IsDefined } from 'class-validator';

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
  user_id: string;

  @IsString()
  @IsNotEmpty()
  @IsDefined()
  token: string;

  @IsString()
  channel?: string;
}

export class UserMessage {
  @IsString()
  @IsNotEmpty()
  @IsDefined()
  user_watchlist_id: string;

  @IsString()
  @IsNotEmpty()
  @IsDefined()
  description: string;
}

export class UserChannel {
  @IsString()
  @IsNotEmpty()
  @IsDefined()
  user_id: string;

  @IsString()
  @IsNotEmpty()
  @IsDefined()
  channel: string;
}
